/**
 * CapAI — Canvas caption renderer
 * PRD §5.2, 5.3, §10 — Dynamic karaoke/pill/pop & scale + Static rendering
 */

import type { CaptionSegment, CaptionStyle } from "./types";
import type { WordToken } from "./types";

export type CaptionMode = "dynamic" | "static";

// ── Google Fonts loader (on demand) ─────────────────────────────────────

const loadedFonts = new Set<string>();

export function loadGoogleFont(fontFamily: string): void {
  if (typeof document === "undefined") return;
  if (!fontFamily || loadedFonts.has(fontFamily)) return;
  // Skip system fonts — impact is system, others are google fonts
  if (fontFamily === "Impact") {
    loadedFonts.add(fontFamily);
    return;
  }
  loadedFonts.add(fontFamily);
  const id = `capai-font-${fontFamily.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  // BUG-AUTH-9: External font fetch without SRI. fonts.googleapis.com CSS is dynamic (no stable SRI hash);
  // ideal is self-host via next/font or /public/fonts and pin with SRI. We set crossOrigin + referrerPolicy
  // and rely on CSP style-src/font-src to restrict. If strict SRI required, bundle fonts locally.
  link.crossOrigin = "anonymous";
  link.referrerPolicy = "no-referrer";
  // Note: `integrity` cannot be pinned for dynamic Google Fonts CSS (varies per UA); self-host to enable SRI.
  // Support both normal and italic with all weights so canvas italic renders without FOUT
  // Use ital,wght axes: 0=roman, 1=italic × 400,700,900
  const familySlug = encodeURIComponent(fontFamily).replace(/%20/g, "+");
  link.href = `https://fonts.googleapis.com/css2?family=${familySlug}:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&display=swap`;
  document.head.appendChild(link);
  // Also attempt to load via FontFace API for faster detection if available
  try {
    if ((document as unknown as { fonts?: FontFaceSet }).fonts && typeof FontFace !== "undefined") {
      // trigger load for both roman and italic
      void (document as unknown as { fonts: FontFaceSet }).fonts.load(`400 12px "${fontFamily}"`);
      void (document as unknown as { fonts: FontFaceSet }).fonts.load(`italic 700 12px "${fontFamily}"`);
    }
  } catch {
    // ignore
  }
}

// Eager helper to preload all supported Google Fonts (optional, not auto-called)
export const SUPPORTED_GOOGLE_FONTS = [
  "Inter",
  "Montserrat",
  "Bebas Neue",
  "Anton",
  "Oswald",
  "Poppins",
  "Roboto",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────

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

function hexToRgba(hex: string, opacity: number): string {
  // Supports #RRGGBB and #RRGGBBAA
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  // if includes alpha, strip
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return `rgba(0,0,0,${opacity})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(0,0,0,${opacity})`;
  return `rgba(${r},${g},${b},${opacity})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
    // modern
    try {
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(x, y, w, h, r);
      return;
    } catch {
      // fallback
    }
  }
  // manual path
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// Determine active word index via timing — mirrors assGenerator gap fix (>150ms highlights first word)
function getActiveWordIndex(words: WordToken[], t: number, segStartMs?: number): number {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (t >= w.startMs && t <= w.endMs) return i;
  }
  // Gap handling: if t is in the leading gap (>150ms) before first word, highlight word 0 to avoid white-on-white at 0:05
  if (typeof segStartMs === "number" && words.length > 0) {
    const firstStart = words[0].startMs;
    if (firstStart - segStartMs > 150 && t >= segStartMs && t < firstStart) return 0;
  }
  // fallback: no active — return -1
  return -1;
}

// ── Main renderer ───────────────────────────────────────────────────────

/**
 * Render a caption segment onto the canvas 2D context.
 * - Clears previous frame
 * - Handles both dynamic (word-level highlight) and static (single block) modes
 * - Applies full CaptionStyle: font, color, stroke, shadow, pill, position, alignment, RTL
 * - Handles karaoke / pill / pop highlight variants
 */
export function renderCaption(
  ctx: CanvasRenderingContext2D,
  segment: CaptionSegment | null,
  style: CaptionStyle,
  currentTimeMs: number,
  mode: CaptionMode,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Defensive: ensure canvas dimensions sensible
  if (!ctx || canvasWidth <= 0 || canvasHeight <= 0) return;

  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!segment) return;

  // Check if segment is active at this time — if not, nothing to draw (or fade would have cleared)
  // For preview we still respect timing: only draw when within [startMs, endMs]
  // However during scrubbing outside range we clear (above). Some callers pass null when inactive.
  // If segment provided but time is outside its range, we still skip unless caller forces.
  // We'll respect: if time outside, don't draw (caller should pass null). But also handle if caller passes segment regardless and we check:
  if (currentTimeMs < segment.startMs - 60 || currentTimeMs > segment.endMs + 60) {
    // allow tiny grace 60ms
    return;
  }

  // Load font on demand (fire and forget)
  if (style.fontFamily) loadGoogleFont(style.fontFamily);

  // Transform text — RTL handled via canvas direction below

  // Prepare base font config
  const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
  const baseWeight = String(style.fontWeight);
  const baseSize = style.fontSize; // px
  const family = style.fontFamily ? `"${style.fontFamily}", Inter, sans-serif` : "Inter, sans-serif";

  // ── WYSIWYG scaling ───────────────────────────────────────────────────
  // Root cause: baseSize (e.g. 60) was absolute. Preview logical W=352 vs export W=1080
  // → same 60px is 17% vs 5.5% → 3.06x mismatch. Also maxContentWidth 0.88*w downscaled
  // preview to 46px but export stayed 60px (2.36x gap).
  // Fix: scale font + geometry relative to preview reference (352) so export matches editor.
  // Preview 60*1=60 (then wraps to 46), Export 60*3.068=184 (then wraps to 141) → both ~13% → WYSIWYG.
  const WYSIWYG_REF_W = 352;
  const WYSIWYG_REF_H = 720;
  const wysiwygScaleW = canvasWidth / WYSIWYG_REF_W;
  const wysiwygScaleH = canvasHeight / WYSIWYG_REF_H;
  // Uniform scale fixes width-vs-height drift for 1080×1920 portrait: previously font used width-only, offset used height-only
  const uniformScale = Math.min(wysiwygScaleW, wysiwygScaleH);
  const wysiwygScale = uniformScale;
  let effectiveBaseSize = baseSize * uniformScale;
  let effectiveStrokeWidth = (style.strokeWidth ?? 0) * uniformScale;
  let effectiveShadowBlur = (style.shadowBlur ?? 0) * uniformScale;
  let effectiveShadowOffsetX = (style.shadowOffsetX ?? 0) * uniformScale;
  let effectiveShadowOffsetY = (style.shadowOffsetY ?? 0) * uniformScale;
  let effectivePillPadX = style.pillPaddingX * uniformScale;
  let effectivePillPadY = style.pillPaddingY * uniformScale;
  let effectivePillRadius = style.pillRadius * uniformScale;
  // Helper to scale hardcoded px constants proportionally
  const scalePx = (n: number) => n * uniformScale;

  // Direction handling
  // Use style.hAlign / position; actual dir will be set on ctx
  // Detect RTL by checking if segment text contains RTL chars or via mode? We'll expose via style? For now handle via ctx.direction based on caller passing rtl flag through style? We check if text matches RTL regex
  const rtlRegex = /[\u0590-\u08FF]/;
  const containsRtl = rtlRegex.test(segment.text);
  // We'll let caller set document dir; but set canvas direction
  try {
    (ctx as unknown as { direction: CanvasDirection }).direction = containsRtl ? "rtl" : "ltr";
  } catch {}

  // Position: vertical anchor
  // top: 15% , center: 50% , bottom: 85%
  const vPreset = style.positionPreset;
  let baseY: number;
  if (vPreset === "top") baseY = canvasHeight * 0.18;
  else if (vPreset === "center") baseY = canvasHeight * 0.5;
  else baseY = canvasHeight * 0.84; // bottom

  // OffsetY: –50 to +50 px — use uniform scale to stay WYSIWYG with font scaling
  const offsetScale = uniformScale;
  baseY += style.positionOffsetY * offsetScale;

  // Horizontal alignment anchor (affects line x)
  const hAlign = style.hAlign; // left/center/right
  const textAlign = style.textAlign; // left/center/right (intra-line)

  // Max content width — leave 6% margin each side
  const maxContentWidth = canvasWidth * 0.88;
  // Use WYSIWYG-scaled pill paddings (already scaled at top)
  const pillPadX = effectivePillPadX;
  const pillPadY = effectivePillPadY;

  // Build lines (handle wrapping)
  // For dynamic: words are units; for static: split segment.text into words
  interface LineWord {
    text: string;
    originalWord?: WordToken; // for dynamic timing
    idx: number; // original index
  }

  const lineWords: LineWord[][] = []; // array of lines, each line is arrays of words
  if (mode === "dynamic" && segment.words && segment.words.length > 0) {
    // Build using dynamic words with transforms
    const transformedWords: LineWord[] = segment.words.map((w, i) => ({
      text: applyTransform(w.word, style.textTransform),
      originalWord: w,
      idx: i,
    }));
    // Wrapping: measure each word
    ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
    // Helper to measure
    const measure = (t: string) => ctx.measureText(t).width;
    // First, check if single line exceeds max: if so, we will wrap; also consider pop scale active word bigger
    let currentLine: LineWord[] = [];
    let currentWidth = 0;
    const spaceW = measure(" ");
    for (const lw of transformedWords) {
      // For pop mode, active word is larger, so measure with larger size if needed for layout?
      // For simplicity, measure with base size; pop will slightly overflow but acceptable
      const w = measure(lw.text);
      const needed = currentLine.length === 0 ? w : currentWidth + spaceW + w;
      if (needed > maxContentWidth && currentLine.length > 0) {
        lineWords.push(currentLine);
        currentLine = [lw];
        currentWidth = w;
      } else {
        if (currentLine.length > 0) currentWidth += spaceW;
        currentLine.push(lw);
        currentWidth += w;
      }
    }
    if (currentLine.length) lineWords.push(currentLine);
  } else {
    // Static: split text
    const rawText = applyTransform(segment.text, style.textTransform);
    const parts = rawText.split(/\s+/).filter(Boolean);
    const words: LineWord[] = parts.map((p, i) => ({ text: p, idx: i }));
    ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
    const measure = (t: string) => ctx.measureText(t).width;
    const spaceW = measure(" ");
    let cur: LineWord[] = [];
    let curW = 0;
    for (const w of words) {
      const ww = measure(w.text);
      const need = cur.length === 0 ? ww : curW + spaceW + ww;
      if (need > maxContentWidth && cur.length > 0) {
        lineWords.push(cur);
        cur = [w];
        curW = ww;
      } else {
        if (cur.length > 0) curW += spaceW;
        cur.push(w);
        curW += ww;
      }
    }
    if (cur.length) lineWords.push(cur);
  }

  if (lineWords.length === 0) return;

  // If still overflow height, scale down font + geometry proportionally
  let lineHeight = effectiveBaseSize * 1.25;
  let totalBlockH = lineWords.length * lineHeight;
  // Ensure block fits vertically (with margins)
  // If totalBlockH > canvasHeight * 0.5, reduce size
  if (totalBlockH > canvasHeight * 0.45) {
    const scale = (canvasHeight * 0.45) / totalBlockH;
    const newBase = Math.max(scalePx(10), effectiveBaseSize * scale);
    const geomScale = newBase / effectiveBaseSize;
    effectiveBaseSize = newBase;
    effectiveStrokeWidth *= geomScale;
    effectiveShadowBlur *= geomScale;
    effectiveShadowOffsetX *= geomScale;
    effectiveShadowOffsetY *= geomScale;
    effectivePillPadX *= geomScale;
    effectivePillPadY *= geomScale;
    effectivePillRadius *= geomScale;
    lineHeight = effectiveBaseSize * 1.25;
    totalBlockH = lineWords.length * lineHeight;
  }

  // Re-measure lines with effective size for accurate widths (especially if scaled)
  // We'll compute line widths for layout
  interface MeasuredLine {
    words: LineWord[];
    width: number;
    wordWidths: number[];
  }
  const measuredLines: MeasuredLine[] = [];
  for (const line of lineWords) {
    ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
    const widths = line.map((lw) => ctx.measureText(lw.text).width);
    // For pop mode, active word larger — so for that line, width will be slightly bigger; compute after determining active?
    // We'll adjust after
    let lineWidth = 0;
    for (let i = 0; i < widths.length; i++) {
      if (i > 0) lineWidth += ctx.measureText(" ").width;
      // If pop and this word active, add extra due to scale 1.15
      if (mode === "dynamic" && style.highlightStyle === "pop") {
        const activeIdx = getActiveWordIndex(segment.words, currentTimeMs, segment.startMs);
        if (line[i].idx === activeIdx) {
          // active word rendered at 1.15x, so width scale 1.15
          lineWidth += widths[i] * 0.15;
        }
      }
      lineWidth += widths[i];
    }
    measuredLines.push({ words: line, width: lineWidth, wordWidths: widths });
  }

  // If any line still exceeds maxContentWidth after scaling, reduce further (WYSIWYG: scale geometry too)
  let maxLineW = Math.max(...measuredLines.map((l) => l.width));
  if (maxLineW > maxContentWidth) {
    const scale = (maxContentWidth / maxLineW) * 0.96;
    const newBase = Math.max(scalePx(8), effectiveBaseSize * scale);
    const geomScale = newBase / effectiveBaseSize;
    effectiveBaseSize = newBase;
    effectiveStrokeWidth *= geomScale;
    effectiveShadowBlur *= geomScale;
    effectiveShadowOffsetX *= geomScale;
    effectiveShadowOffsetY *= geomScale;
    effectivePillPadX *= geomScale;
    effectivePillPadY *= geomScale;
    effectivePillRadius *= geomScale;
    lineHeight = effectiveBaseSize * 1.25;
    // re-measure
    measuredLines.length = 0;
    for (const line of lineWords) {
      ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
      const widths = line.map((lw) => ctx.measureText(lw.text).width);
      let lwTotal = 0;
      for (let i = 0; i < widths.length; i++) {
        if (i > 0) lwTotal += ctx.measureText(" ").width;
        if (mode === "dynamic" && style.highlightStyle === "pop") {
          const activeIdx = getActiveWordIndex(segment.words, currentTimeMs, segment.startMs);
          if (line[i].idx === activeIdx) lwTotal += widths[i] * 0.15;
        }
        lwTotal += widths[i];
      }
      measuredLines.push({ words: line, width: lwTotal, wordWidths: widths });
    }
  } else {
    // Keep lineHeight in sync even when no second scaling occurred
    lineHeight = effectiveBaseSize * 1.25;
  }

  // Now draw background pills (global) and subtle active rect
  // Note: per-line pills handle wrapping better than a single block rect

  // For textAlign per line, lineX may differ from blockX, but we can handle pill per line rather than one big rect for multi-line readability
  // We'll draw pill per line (like separate rounded rects) for better appearance when wrapped.

  // Global pill drawing per line (if enabled)
  if (style.pillEnabled) {
    ctx.save();
    const pillCol = hexToRgba(style.pillColor, style.pillOpacity);
    ctx.fillStyle = pillCol;
    for (let li = 0; li < measuredLines.length; li++) {
      const ml = measuredLines[li];
      // lineX per textAlign/hAlign
      let lineX: number;
      if (textAlign === "left" || hAlign === "left") lineX = canvasWidth * 0.06;
      else if (textAlign === "right" || hAlign === "right") lineX = canvasWidth - ml.width - canvasWidth * 0.06;
      else lineX = (canvasWidth - ml.width) / 2;
      // Also consider RTL: mirror?
      // For RTL, keep centered logic but alignment flipped? We'll just respect same as LTR center
      const lineY = baseY - (measuredLines.length - 1) * lineHeight * 0.5 + li * lineHeight;
      const rectX = lineX - effectivePillPadX;
      const rectY = lineY - effectiveBaseSize - effectivePillPadY + scalePx(4); // adjust baseline
      const rectW = ml.width + effectivePillPadX * 2;
      const rectH = effectiveBaseSize + effectivePillPadY * 2 + scalePx(4);
      ctx.beginPath();
      roundRect(ctx, rectX, rectY, rectW, rectH, effectivePillRadius);
      ctx.fill();
    }
    ctx.restore();
  } else {
    // Subtle translucent rounded rect behind active caption text block (200ms fade spec — we just draw static 0.08)
    // Only when segment active — scaled for WYSIWYG
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let li = 0; li < measuredLines.length; li++) {
      const ml = measuredLines[li];
      let lineX: number;
      if (textAlign === "left" || hAlign === "left") lineX = canvasWidth * 0.06;
      else if (textAlign === "right" || hAlign === "right") lineX = canvasWidth - ml.width - canvasWidth * 0.06;
      else lineX = (canvasWidth - ml.width) / 2;
      const lineY = baseY - (measuredLines.length - 1) * lineHeight * 0.5 + li * lineHeight;
      const padX = scalePx(6), padY = scalePx(2);
      const rectX = lineX - padX;
      const rectY = lineY - effectiveBaseSize - padY + scalePx(4);
      const rectW = ml.width + padX * 2;
      const rectH = effectiveBaseSize + padY * 2 + scalePx(4);
      ctx.beginPath();
      roundRect(ctx, rectX, rectY, rectW, rectH, scalePx(8));
      ctx.fill();
    }
    ctx.restore();
  }

  // Shadow setup — applied per text draw (WYSIWYG scaled)
  const hasShadow = effectiveShadowBlur > 0 || effectiveShadowOffsetX !== 0 || effectiveShadowOffsetY !== 0;
  // Stroke setup
  const hasStroke = effectiveStrokeWidth > 0 && style.strokeColor;

  // Dynamic mode per-word draw — gap fix mirrors ASS: highlight first word during leading 150ms gap
  if (mode === "dynamic" && segment.words && segment.words.length > 0) {
    const activeIdx = getActiveWordIndex(segment.words, currentTimeMs, segment.startMs);
    const spaceW = (() => {
      ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
      return ctx.measureText(" ").width;
    })();

    for (let li = 0; li < measuredLines.length; li++) {
      const ml = measuredLines[li];
      let lineX: number;
      if (textAlign === "left" || hAlign === "left") lineX = canvasWidth * 0.06;
      else if (textAlign === "right" || hAlign === "right") lineX = canvasWidth - ml.width - canvasWidth * 0.06;
      else lineX = (canvasWidth - ml.width) / 2;
      const lineY = baseY - (measuredLines.length - 1) * lineHeight * 0.5 + li * lineHeight;

      let cursorX = lineX;
      for (let wi = 0; wi < ml.words.length; wi++) {
        const lw = ml.words[wi];
        const isActive = lw.idx === activeIdx;
        const wordText = lw.text;

        // Determine style for this word
        let wordColor: string;
        let wordWeight = baseWeight;
        let wordSize = effectiveBaseSize;
        let drawPillBehind = false;

        if (style.highlightStyle === "karaoke") {
          wordColor = isActive ? style.activeWordColor : style.inactiveWordColor;
          if (isActive) wordWeight = "900";
        } else if (style.highlightStyle === "pill") {
          // All words same text color, active word gets pill behind
          wordColor = isActive ? style.activeWordColor : style.inactiveWordColor;
          // Or fallback to style.color if active colors not set?
          // Use style.color as base if highlight colors are translucent variants
          // We'll keep as defined: karaoke vs pill both use active/inactive
          // For pill variant, spec says all same text color but we use highlight colors for better contrast
          if (!wordColor || wordColor.endsWith("AA")) {
            // if inactive has alpha, keep
          }
          drawPillBehind = isActive;
          if (isActive) wordWeight = "900";
        } else if (style.highlightStyle === "pop") {
          wordColor = isActive ? style.activeWordColor : style.inactiveWordColor;
          if (isActive) {
            wordWeight = "900";
            wordSize = effectiveBaseSize * 1.15;
          }
        } else {
          wordColor = style.color;
        }

        // Fallback if wordColor is empty
        if (!wordColor) wordColor = style.color;

        // If pill highlight, draw behind active word
        if (drawPillBehind && isActive) {
          ctx.save();
          // Use pillColor with opacity for highlight pill, but if global pill already drawn, use a brighter variant?
          // We'll draw a pill with activeWordColor-derived background? Simpler to use pillColor at opacity
          // For Clean preset, pillColor black 70% — highlight pill would be same as global, so make highlight slightly lighter?
          // We'll use a distinct highlight: active word pill using pillColor but with 0.9 opacity and inset?
          // To meet spec literally, use pillColor/pillOpacity
          const highlightFill = hexToRgba(style.pillColor, Math.min(1, style.pillOpacity + 0.15));
          ctx.fillStyle = highlightFill;
          // measure word with its weight/size for accurate rect (scaled)
          ctx.font = `${fontStyle} ${wordWeight} ${wordSize}px ${family}`;
          const wMetrics = ctx.measureText(wordText);
          const wWidth = wMetrics.width;
          const pillPad = scalePx(4);
          const rX = cursorX - pillPad;
          const rY = lineY - wordSize - scalePx(2);
          const rW = wWidth + pillPad * 2;
          const rH = wordSize + scalePx(4);
          ctx.beginPath();
          roundRect(ctx, rX, rY, rW, rH, effectivePillRadius || scalePx(6));
          ctx.fill();
          ctx.restore();
        }

        // Draw text
        ctx.save();
        ctx.font = `${fontStyle} ${wordWeight} ${wordSize}px ${family}`;
        ctx.fillStyle = wordColor;
        ctx.textBaseline = "alphabetic";
        // Shadow (WYSIWYG scaled)
        if (hasShadow) {
          ctx.shadowColor = style.shadowColor;
          ctx.shadowBlur = effectiveShadowBlur;
          ctx.shadowOffsetX = effectiveShadowOffsetX;
          ctx.shadowOffsetY = effectiveShadowOffsetY;
        } else {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
        // Handle RTL: for RTL, words are already in logical order but visual should be RTL — we already set ctx.direction
        // Draw fill
        // For pop scale, we need to adjust Y to keep baseline aligned when size larger (center vertically)
        let drawY = lineY;
        if (style.highlightStyle === "pop" && isActive) {
          // Slight lift to center larger text
          drawY = lineY + (effectiveBaseSize * 0.15) * 0.3;
        }
        // Stroke first if needed (under fill) — scaled
        if (hasStroke) {
          ctx.strokeStyle = style.strokeColor;
          ctx.lineWidth = effectiveStrokeWidth;
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          ctx.strokeText(wordText, cursorX, drawY);
        }
        ctx.fillText(wordText, cursorX, drawY);
        ctx.restore();

        // Advance cursor
        // Measure with same font for next word spacing
        ctx.font = `${fontStyle} ${wordWeight} ${wordSize}px ${family}`;
        const wAdvance = ctx.measureText(wordText).width;
        // For pop, we already accounted extra width in line width calc, but cursor advance should be actual rendered width + space
        cursorX += wAdvance + spaceW;
      }
    }
  } else {
    // Static mode: draw each line as single block with style.color
    for (let li = 0; li < measuredLines.length; li++) {
      const ml = measuredLines[li];
      let lineX: number;
      if (textAlign === "left" || hAlign === "left") lineX = canvasWidth * 0.06;
      else if (textAlign === "right" || hAlign === "right") lineX = canvasWidth - ml.width - canvasWidth * 0.06;
      else lineX = (canvasWidth - ml.width) / 2;
      const lineY = baseY - (measuredLines.length - 1) * lineHeight * 0.5 + li * lineHeight;
      const lineText = ml.words.map((w) => w.text).join(" ");

      ctx.save();
      ctx.font = `${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
      ctx.fillStyle = style.color;
      ctx.textBaseline = "alphabetic";
      if (hasShadow) {
        ctx.shadowColor = style.shadowColor;
        ctx.shadowBlur = effectiveShadowBlur;
        ctx.shadowOffsetX = effectiveShadowOffsetX;
        ctx.shadowOffsetY = effectiveShadowOffsetY;
      }
      if (hasStroke) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = effectiveStrokeWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(lineText, lineX, lineY);
      }
      ctx.fillText(lineText, lineX, lineY);
      ctx.restore();
    }
  }
}

// Convenience helper to find active segment at time
export function getActiveSegment(
  segments: CaptionSegment[],
  currentTimeMs: number
): CaptionSegment | null {
  for (const s of segments) {
    if (currentTimeMs >= s.startMs && currentTimeMs <= s.endMs) return s;
  }
  return null;
}
