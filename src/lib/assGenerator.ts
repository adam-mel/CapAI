/**
 * CapAI — ASS subtitle generator
 * PRD §4.7 — Generates ASS file from segments+style for FFmpeg burn-in.
 */

import type { CaptionSegment, CaptionStyle } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────

function applyTransform(text: string, transform: CaptionStyle["textTransform"]): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

function escapeAssText(text: string): string {
  // Escape literal braces and backslashes inside user text.
  // We handle tags ourselves, so escape user-provided { } \
  return text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function formatAssTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalCs = Math.floor(clamped / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Convert hex colour + opacity to ASS &HAABBGGRR (ABGR with inverted alpha)
 * Input hex may be #RRGGBB or #RRGGBBAA (AA = alpha FF opaque)
 * opacityOverride 0..1 where 1=opaque
 */
function hexToAssColour(input: string | undefined | null, opacityOverride?: number): string {
  if (!input || typeof input !== "string") return "&H00FFFFFF";
  let hex = input.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  let rHex: string | undefined;
  let gHex: string | undefined;
  let bHex: string | undefined;
  let aHex: string | undefined;
  if (hex.length === 8) {
    rHex = hex.slice(0, 2);
    gHex = hex.slice(2, 4);
    bHex = hex.slice(4, 6);
    aHex = hex.slice(6, 8);
  } else if (hex.length === 6) {
    rHex = hex.slice(0, 2);
    gHex = hex.slice(2, 4);
    bHex = hex.slice(4, 6);
  } else {
    // fallback white
    return "&H00FFFFFF";
  }
  const r = rHex || "FF";
  const g = gHex || "FF";
  const b = bHex || "FF";

  let alpha: number;
  if (typeof opacityOverride === "number" && Number.isFinite(opacityOverride)) {
    const op = Math.max(0, Math.min(1, opacityOverride));
    alpha = Math.round((1 - op) * 255);
  } else if (aHex) {
    const hexAlpha = parseInt(aHex, 16);
    if (Number.isNaN(hexAlpha)) alpha = 0;
    else alpha = 255 - hexAlpha;
  } else {
    alpha = 0;
  }
  alpha = Math.max(0, Math.min(255, alpha));
  const aStr = alpha.toString(16).padStart(2, "0").toUpperCase();
  const rUp = r.toUpperCase().padStart(2, "0");
  const gUp = g.toUpperCase().padStart(2, "0");
  const bUp = b.toUpperCase().padStart(2, "0");
  // ASS order &HAABBGGRR
  return `&H${aStr}${bUp}${gUp}${rUp}`;
}

function alignmentFor(style: CaptionStyle): number {
  const v = style.positionPreset;
  const h = style.hAlign;
  if (v === "top") {
    if (h === "left") return 7;
    if (h === "right") return 9;
    return 8;
  }
  if (v === "center") {
    if (h === "left") return 4;
    if (h === "right") return 6;
    return 5;
  }
  // bottom
  if (h === "left") return 1;
  if (h === "right") return 3;
  return 2;
}

function marginVFor(style: CaptionStyle, videoHeight: number, videoWidth?: number): number {
  // Use uniform scale for offset to match font scaling (fixes portrait drift)
  const uniformScale = videoWidth ? Math.min(videoWidth / 352, videoHeight / 720) : videoHeight / 720;
  const offsetScaled = style.positionOffsetY * uniformScale;
  if (style.positionPreset === "bottom") {
    const base = Math.round(videoHeight * 0.16); // ~115 for 720p
    return Math.max(10, Math.round(base - offsetScaled));
  }
  if (style.positionPreset === "top") {
    const base = Math.round(videoHeight * 0.18); // ~130 for 720p
    return Math.max(10, Math.round(base + offsetScaled));
  }
  // center: for middle alignment MarginV is less critical; but we offset from center via pos-like margin
  // Approximate: distance from bottom to center is ~0.34*height; add offset
  // We'll set margin so center moves with offset, but center alignment ignores MarginV in some renderers.
  // To keep spec simple, return a moderate value with offset.
  // Use 20 as base and add half offset effect.
  const base = Math.round(videoHeight * 0.05);
  return Math.max(10, Math.round(base + offsetScaled * 0.5 + 20));
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Generate ASS subtitle file content.
 * @param segments Sorted list of caption segments
 * @param style Current caption style
 * @param videoWidth PlayResX — if omitted defaults to 1280
 * @param videoHeight PlayResY — if omitted defaults to 720
 * @param mode Dynamic or Static — controls per-word highlight generation
 * @param durationMs Optional total duration (not critical for ASS)
 */
export function generateASS(
  segments: CaptionSegment[],
  style: CaptionStyle,
  videoWidth?: number,
  videoHeight?: number,
  mode?: "dynamic" | "static",
  durationMs?: number
): string {
  void durationMs;
  // Validation: require real dims to avoid PlayRes mismatch (e.g., 1280x720 fallback for 1080x1920 vertical → off-screen)
  if (!videoWidth || !videoHeight || videoWidth < 320 || videoHeight < 240) {
    throw new Error("Missing video dimensions for ASS header");
  }
  const playResX = Math.round(videoWidth);
  const playResY = Math.round(videoHeight);
  const resolvedMode: "dynamic" | "static" = mode ?? "static";

  const filtered = [...segments].sort((a, b) => a.startMs - b.startMs);

  // Style mapping
  const fontName = style.fontFamily?.trim() ? style.fontFamily.trim() : "Arial";
  // ASS font names: strip quotes, keep as provided; Impact is a system font not bundled in wasm /fonts
  // so libass would fallback unpredictably (sometimes invisible). Map to a bundled substitute that retains
  // the Bold Drop heavy weight but is guaranteed present. Montserrat succeeded in 7-seg test; Arial/DejaVu
  // is always in 0.12.10. Keep canvas preview on Impact, but burn-in on Arial Black.
  const rawSanitized = fontName.replace(/"/g, "");
  const ASS_FONT_FALLBACKS: Record<string, string> = {
    Impact: "Arial Black",
    "Bebas Neue": "Arial",
    Anton: "Arial",
    Oswald: "Arial",
  };
  const fontNameSanitized = ASS_FONT_FALLBACKS[rawSanitized] ?? rawSanitized;
  if (rawSanitized !== fontNameSanitized) {
    console.warn(`[ass] font fallback: "${rawSanitized}" → "${fontNameSanitized}" for wasm libass (system font not bundled)`);
  }
  // ── WYSIWYG scaling — uniform min(W,H) to match canvasRenderer and avoid 1080×1920 off-screen drift
  const WYSIWYG_REF_W = 352;
  const WYSIWYG_REF_H = 720;
  const scaleW = playResX / WYSIWYG_REF_W;
  const scaleH = playResY / WYSIWYG_REF_H;
  const wysiwygScale = Math.min(scaleW, scaleH);
  const rawScaledFontSize = (style.fontSize || 48) * wysiwygScale;
  const fontSize = Math.max(10, Math.min(400, Math.round(rawScaledFontSize)));
  const primaryColour = hexToAssColour(style.color);
  const secondaryColour = hexToAssColour(style.activeWordColor || style.color);
  // Outline = stroke (scaled)
  const outlineColour = hexToAssColour(style.strokeColor || "#000000");
  // BackColour depends on pill
  let backColour: string;
  let borderStyle: number;
  if (style.pillEnabled) {
    backColour = hexToAssColour(style.pillColor, style.pillOpacity);
    borderStyle = 3; // opaque box
  } else {
    // Transparent box / shadow color still needs value
    backColour = hexToAssColour(style.pillColor ?? "#000000", 0);
    // When not using box, ensure we have outline shadow style
    borderStyle = 1;
  }

  const bold = style.fontWeight === 400 ? 0 : -1;
  const italic = style.fontStyle === "italic" ? -1 : 0;
  const underline = 0;
  const strikeOut = 0;
  const scaleX = 100;
  const scaleY = 100;
  const spacing = 0;
  const angle = 0;
  const outline = Math.max(0, Math.round((style.strokeWidth ?? 0) * wysiwygScale));
  const hasShadow = (style.shadowBlur ?? 0) > 0 || (style.shadowOffsetX ?? 0) !== 0 || (style.shadowOffsetY ?? 0) !== 0;
  // Shadow integer in ASS is scaled border — multiply by WYSIWYG scale so shadow stays proportional
  // Preview 352→1, Export 1080→3.068→3 — matches canvas scaled blur/offset.
  const shadow = hasShadow ? Math.max(1, Math.round(wysiwygScale)) : 0;
  const alignment = alignmentFor(style);
  const marginL = 10;
  const marginR = 10;
  const marginV = marginVFor(style, playResY, playResX);
  const encoding = 1;
  console.debug("[ass] PlayRes", playResX, playResY, "MarginV", marginV);

  // Header
  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push("; CapAI Generated ASS — burned-in captions");
  lines.push("Title: CapAI Export");
  lines.push("ScriptType: v4.00+");
  lines.push(`PlayResX: ${playResX}`);
  lines.push(`PlayResY: ${playResY}`);
  lines.push("WrapStyle: 0");
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("YCbCr Matrix: TV.709");
  lines.push("Collisions: Normal");
  lines.push("");

  lines.push("[V4+ Styles]");
  lines.push(
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
  );
  const styleLine = [
    "Default",
    fontNameSanitized,
    String(fontSize),
    primaryColour,
    secondaryColour,
    outlineColour,
    backColour,
    String(bold),
    String(italic),
    String(underline),
    String(strikeOut),
    String(scaleX),
    String(scaleY),
    String(spacing),
    String(angle),
    String(borderStyle),
    String(outline),
    String(shadow),
    String(alignment),
    String(marginL),
    String(marginR),
    String(marginV),
    String(encoding),
  ].join(",");
  lines.push(`Style: ${styleLine}`);
  lines.push("");

  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  const activeAss = hexToAssColour(style.activeWordColor || style.color);
  const inactiveAss = hexToAssColour(style.inactiveWordColor || style.color);

  // If no segments, just emit empty events
  if (filtered.length === 0) {
    // No dialogue lines — still valid ASS
    return lines.join("\r\n");
  }

  for (const seg of filtered) {
    // Skip empty segments with no text and no words
    const hasText = typeof seg.text === "string" && seg.text.trim().length > 0;
    const hasWords = Array.isArray(seg.words) && seg.words.length > 0;
    if (!hasText && !hasWords) continue;

    // Clamp times
    const segStart = Math.max(0, seg.startMs);
    const segEnd = Math.max(segStart + 100, seg.endMs);
    if (segEnd <= segStart) continue;

    if (resolvedMode === "static" || !hasWords) {
      const raw = hasText ? seg.text : (seg.words?.map((w) => w.word).join(" ") ?? "");
      const transformed = applyTransform(raw, style.textTransform);
      const escaped = escapeAssText(transformed);
      const startStr = formatAssTime(segStart);
      const endStr = formatAssTime(segEnd);
      // For alignment center, optionally add \pos? We keep spec simple without \pos for static.
      // Text for static: single line, no highlight
      // If pillEnabled, BackColour already provides box; else subtle
      lines.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${escaped}`);
    } else {
      // Dynamic mode: per-word highlight sequence
      const words = seg.words;
      if (!words || words.length === 0) {
        const raw = seg.text || "";
        const transformed = applyTransform(raw, style.textTransform);
        const escaped = escapeAssText(transformed);
        lines.push(`Dialogue: 0,${formatAssTime(segStart)},${formatAssTime(segEnd)},Default,,0,0,0,,${escaped}`);
        continue;
      }

      // Ensure words sorted by start
      const sortedWords = [...words].sort((a, b) => a.startMs - b.startMs);

      // Build highlight intervals covering segment continuously.
      // Approach: for each word i, create an event from its start to next word start (or segEnd for last).
      // Fix: gap white-on-white at 0:05 — previously gap 80ms produced all-white (inactive #FFFFFF) on bright stickman → invisible.
      // Now threshold raised to 150ms (was 80) and gap shows first word highlighted gold for visibility.
      const firstWordStart = Math.max(segStart, sortedWords[0].startMs);
      if (firstWordStart - segStart > 150) {
        const gapTextParts: string[] = [];
        for (let j = 0; j < sortedWords.length; j++) {
          const wText = escapeAssText(applyTransform(sortedWords[j].word, style.textTransform));
          if (j === 0) {
            // Highlight first word gold in gap — avoids white-on-white flash on bright background
            let tags = `\\c${activeAss}&\\b1`;
            if (style.highlightStyle === "pop") {
              const larger = Math.round(fontSize * 1.15);
              tags += `\\fs${larger}`;
            }
            gapTextParts.push(`{${tags}}${wText}{\\r}`);
          } else {
            gapTextParts.push(`{\\c${inactiveAss}&}${wText}{\\r}`);
          }
        }
        const gapText = gapTextParts.join(" ");
        lines.push(
          `Dialogue: 0,${formatAssTime(segStart)},${formatAssTime(firstWordStart)},Default,,0,0,0,,${gapText}`
        );
      }

      for (let i = 0; i < sortedWords.length; i++) {
        const w = sortedWords[i];
        const intervalStart = Math.max(segStart, w.startMs);
        let intervalEnd: number;
        if (i < sortedWords.length - 1) {
          const nextStart = sortedWords[i + 1].startMs;
          // Ensure interval is at least 80ms and not overlapping incorrectly
          intervalEnd = Math.max(intervalStart + 80, nextStart);
          // Clamp to segEnd
          if (intervalEnd > segEnd) intervalEnd = segEnd;
          // If nextStart is before intervalStart due to bad data, fallback to w.endMs
          if (intervalEnd <= intervalStart) intervalEnd = Math.max(intervalStart + 80, w.endMs);
        } else {
          intervalEnd = segEnd;
          // Ensure highlight for last word covers to segEnd, but if w.endMs significantly earlier, still to segEnd
          if (intervalEnd <= intervalStart) intervalEnd = intervalStart + 200;
        }

        // Build line with word i highlighted
        const parts: string[] = [];
        for (let j = 0; j < sortedWords.length; j++) {
          const wordOrig = sortedWords[j].word;
          const txt = escapeAssText(applyTransform(wordOrig, style.textTransform));
          if (j === i) {
            // Active
            let tags = `\\c${activeAss}&\\b1`;
            if (style.highlightStyle === "pop") {
              const larger = Math.round(fontSize * 1.15);
              tags += `\\fs${larger}`;
            } else if (style.highlightStyle === "pill") {
              // pill highlight approximated with still bold + maybe \3c border? Keep simple bold
              // For pill, we could add outline increase? Keep bold.
            }
            // Karaoke and pill both use color+bold
            parts.push(`{${tags}}${txt}{\\r}`);
          } else {
            // Inactive — apply inactive color explicitly so whole line doesn't revert to primary (white)
            parts.push(`{\\c${inactiveAss}&}${txt}{\\r}`);
          }
        }
        const lineText = parts.join(" ");
        const sStr = formatAssTime(intervalStart);
        const eStr = formatAssTime(intervalEnd);
        lines.push(`Dialogue: 0,${sStr},${eStr},Default,,0,0,0,,${lineText}`);
      }
    }
  }

  return lines.join("\r\n");
}

// ── SRT fallback (helper for error path) ──────────────────────────────────

export function generateSRT(
  segments: CaptionSegment[],
  style?: CaptionStyle | null,
  mode?: "dynamic" | "static"
): string {
  void mode;
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const out: string[] = [];
  const transform = style?.textTransform ?? "none";
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!s.text && (!s.words || s.words.length === 0)) continue;
    const raw = s.text || s.words.map((w) => w.word).join(" ");
    const txt = applyTransform(raw, transform);
    const start = formatSRTTime(s.startMs);
    const end = formatSRTTime(s.endMs);
    out.push(String(i + 1));
    out.push(`${start} --> ${end}`);
    out.push(txt);
    out.push("");
  }
  return out.join("\n");
}

function formatSRTTime(ms: number): string {
  const m = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(m / 1000);
  const milli = m % 1000;
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

export { formatAssTime, hexToAssColour, escapeAssText };
