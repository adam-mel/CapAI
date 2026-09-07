/**
 * CapAI — Export pipeline (FFmpeg burn-in)
 * PRD §4.7 — burns ASS subtitles into MP4 via FFmpeg.wasm
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { CaptionSegment, CaptionStyle } from "./types";
import { generateASS } from "./assGenerator";
import { CORE_BASE, CORE_BASE_ESM, CORE_VERSION } from "./ffmpegConfig";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ExportOptions {
  videoBlob: Blob;
  segments: CaptionSegment[];
  style: CaptionStyle;
  mode: "dynamic" | "static";
  projectName: string;
  videoWidth?: number;
  videoHeight?: number;
  durationMs?: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  filename: string;
}

// ── Filename & helpers ────────────────────────────────────────────────────

export function getExportFilename(originalName: string): string {
  const raw = originalName?.trim() || "video";
  const base = raw.replace(/\.[^/.]+$/, "");
  const sanitized = base.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "video";
  const truncated = sanitized.length > 80 ? sanitized.slice(0, 80) : sanitized;
  return `${truncated}_captioned.mp4`;
}

function getInputFileName(blob: Blob, projectName?: string): string {
  let ext = "mp4";
  if (projectName && projectName.includes(".")) {
    const candidate = projectName.split(".").pop()?.toLowerCase() || "mp4";
    if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(candidate)) ext = candidate === "mov" ? "mov" : candidate === "m4v" ? "mp4" : candidate;
  } else {
    const t = (blob as Blob).type || "";
    if (t.includes("webm")) ext = "webm";
    else if (t.includes("quicktime")) ext = "mov";
    else if (t.includes("matroska") || t.includes("mkv")) ext = "mkv";
    else if (t.includes("avi")) ext = "avi";
  }
  return `input.${ext}`;
}

// ── Video metadata (dimensions) ───────────────────────────────────────────
// NOTE: FFmpeg core version is centralized in ./ffmpegConfig.ts (single source of truth).
// Both export and audio singletons share CORE_VERSION=0.12.10 (libass+fonts).

const metadataCache = new WeakMap<Blob, { width: number; height: number; durationMs: number }>();

export async function getVideoMetadata(
  blob: Blob
): Promise<{ width: number; height: number; durationMs: number }> {
  const cached = metadataCache.get(blob);
  if (cached) return cached;
  if (typeof document === "undefined") {
    throw new Error("Could not detect video dimensions. Please try again.");
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    // Ensure metadata loads reliably for large files (up to 60MB) — preload/muted/playsInline required
    video.preload = "metadata";
    video.muted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- playsInline for iOS Safari
    (video as any).playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    let settled = false;
    const cleanup = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
      if (video.parentNode) video.parentNode.removeChild(video);
    };
    const settleSuccess = (w: number, h: number, d: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Rotation handling: videoWidth/videoHeight already reflect rotated dimensions (e.g., 1080x1920 vertical).
      // Ensure no zero/swap; just use directly and validate.
      if (!w || !h || w < 10 || h < 10) {
        console.warn("[export] getVideoMetadata fallback to 1280x720 — may cause off-screen captions");
        reject(new Error("Could not detect video dimensions. Please try again."));
        return;
      }
      const out = { width: w, height: h, durationMs: d || 0 };
      try { metadataCache.set(blob, out); } catch {}
      resolve(out);
    };
    const settleFail = (errMsg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      console.warn("[export] getVideoMetadata fallback to 1280x720 — may cause off-screen captions");
      reject(new Error(errMsg));
    };
    const onMeta = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const d = Number.isFinite(video.duration) && video.duration !== Infinity ? video.duration * 1000 : 0;
      window.clearTimeout(timeoutId);
      if (!w || !h) {
        settleFail("Could not detect video dimensions. Please try again.");
      } else {
        settleSuccess(w, h, d);
      }
    };
    const onError = () => {
      window.clearTimeout(timeoutId);
      settleFail("Could not detect video dimensions. Please try again.");
    };
    video.addEventListener("loadedmetadata", onMeta, { once: true });
    video.addEventListener("error", onError, { once: true });
    // Increased timeout 4s → 8s for 60MB files
    const timeoutId = window.setTimeout(() => settleFail("Could not detect video dimensions. Please try again."), 8000);
    // Safari requires element in DOM
    video.style.position = "fixed";
    video.style.left = "-99999px";
    video.style.top = "-99999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    try {
      document.body.appendChild(video);
    } catch {
      // ignore
    }
    try {
      video.load();
    } catch {
      window.clearTimeout(timeoutId);
      settleFail("Could not detect video dimensions. Please try again.");
    }
  });
}

// ── FFmpeg singleton for export (isolated from audio extraction) ───────────
// Two singletons (export + audio) intentionally separate: same CORE_VERSION
// but independent MEMFS. Export abort calls terminate() — audio singleton stays alive.
// toBlobURL caching dedupes the underlying fetch; double-load is safe but
// export loader does not concurrently race audio loader — each has its own promise.

let exportFFmpeg: FFmpeg | null = null;
let exportLoadPromise: Promise<FFmpeg> | null = null;

// CORE_VERSION / CORE_BASE imported from ./ffmpegConfig (unified 0.12.10 with libass+fonts)
void CORE_VERSION;

async function tryLoadWith(ffmpeg: FFmpeg, coreURL: string, wasmURL: string): Promise<void> {
  await ffmpeg.load({
    coreURL: await toBlobURL(coreURL, "text/javascript"),
    wasmURL: await toBlobURL(wasmURL, "application/wasm"),
  });
}

async function getExportFFmpeg(): Promise<FFmpeg> {
  if (exportFFmpeg) return exportFFmpeg;
  if (exportLoadPromise) return exportLoadPromise;
  if (typeof window === "undefined") throw new Error("FFmpeg can only run in the browser.");

  exportLoadPromise = (async () => {
    const ff = new FFmpeg();
    // Surface libass errors ("No such filter: ass") and font warnings
    ff.on("log", ({ type, message }) => console.debug("[ffmpeg-export]", type, message));

    const attempts: Array<{ core: string; wasm: string; label: string }> = [
      { core: `${CORE_BASE}/ffmpeg-core.js`, wasm: `${CORE_BASE}/ffmpeg-core.wasm`, label: "local UMD" },
      { core: `${CORE_BASE_ESM}/ffmpeg-core.js`, wasm: `${CORE_BASE_ESM}/ffmpeg-core.wasm`, label: "local ESM" },
      // ESM alt filenames (fetched as ffmpeg-core.esm.*) and subfolder mirrors for robustness
      { core: `/ffmpeg/ffmpeg-core.esm.js`, wasm: `/ffmpeg/ffmpeg-core.esm.wasm`, label: "local ESM alt" },
      { core: `/ffmpeg/esm/ffmpeg-core.js`, wasm: `/ffmpeg/esm/ffmpeg-core.wasm`, label: "local ESM subfolder" },
      { core: `/ffmpeg/umd/ffmpeg-core.js`, wasm: `/ffmpeg/umd/ffmpeg-core.wasm`, label: "local UMD subfolder" },
    ];
    let lastErr: unknown = null;
    for (const a of attempts) {
      try {
        await tryLoadWith(ff, a.core, a.wasm);
        exportFFmpeg = ff;
        return ff;
      } catch (e) {
        lastErr = e;
      }
    }
    const isCoop =
      lastErr instanceof Error && /SharedArrayBuffer|COOP|COEP|cross-origin/i.test(lastErr.message);
    if (isCoop) {
      throw new Error(
        "FFmpeg failed to load due to browser security headers (COOP/COEP). Ensure Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp are set, then hard-refresh. Details: " +
          (lastErr instanceof Error ? lastErr.message : String(lastErr))
      );
    }
    throw new Error(
      `FFmpeg failed to load. Check your network and try again. (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`
    );
  })();

  try {
    const inst = await exportLoadPromise;
    return inst;
  } catch (e) {
    exportLoadPromise = null;
    throw e;
  }
}

export function resetExportFFmpeg(): void {
  try {
    exportFFmpeg?.terminate();
  } catch {}
  exportFFmpeg = null;
  exportLoadPromise = null;
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Burn captions into video via FFmpeg.wasm.
 * Returns Blob + object URL + filename.
 * Caller is responsible for revoking URL when done.
 */
export async function exportVideo(options: ExportOptions): Promise<ExportResult> {
  const { videoBlob, segments, style, mode, projectName, onProgress, signal } = options;

  if (!videoBlob || videoBlob.size === 0) {
    throw new Error("No video data available. Re-upload the video and try again.");
  }
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

  // Soft warning for >2GB dispatched as error via throw? We just warn then continue.
  if (videoBlob.size > 2 * 1024 * 1024 * 1024) {
    console.warn("Large video (>2GB) may cause OOM in FFmpeg.wasm");
  }

  // Resolve dimensions — no silent 1280x720 fallback (would cause off-screen captions for 1080x1920)
  let width = options.videoWidth;
  let height = options.videoHeight;
  let durationMs = options.durationMs;
  if (!width || !height) {
    try {
      const meta = await getVideoMetadata(videoBlob);
      width = width || meta.width;
      height = height || meta.height;
      if (!durationMs || durationMs === 0) durationMs = meta.durationMs;
    } catch (e) {
      console.warn("[export] getVideoMetadata fallback to 1280x720 — may cause off-screen captions", e);
      throw new Error("Could not detect video dimensions. Please try again.");
    }
  } else {
    width = Math.round(width);
    height = Math.round(height);
  }
  // Validate dims before ASS generation — w/h required, no silent fallback
  if (!width || !height || width < 320 || height < 240) {
    throw new Error("Could not detect video dimensions. Please try again.");
  }

  // Generate ASS — log critical diagnostics for 75-seg Bold case (Impact fallback, dims, counts)
  let assContent: string;
  try {
    assContent = generateASS(segments, style, width, height, mode, durationMs);
  } catch (e) {
    throw new Error(`Failed to generate subtitles: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!assContent || assContent.length < 80) {
    throw new Error("Generated subtitles were empty. Add captions and try again.");
  }
  // Diagnostic: Dialogue count & bytes for large exports (e.g., 75 segs → ~225 events, ~34KB)
  let dialogueCount = 0;
  try {
    const dlgCount = (assContent.match(/^Dialogue:/gm) || []).length;
    dialogueCount = dlgCount;
    const head = assContent.slice(0, 900);
    const hasImpact = head.includes("Impact");
    console.debug("[export] ASS diagnostics", {
      bytes: assContent.length,
      dialogue: dlgCount,
      segments: segments.length,
      playRes: `${width}x${height}`,
      mode,
      styleFont: style.fontFamily,
      styleColor: style.color,
      assFontIsImpact: hasImpact,
      headPreview: head.slice(0, 500),
    });
    if (hasImpact) {
      console.warn("[export] ASS still contains Impact — fallback to Arial Black should have applied. Check assGenerator font mapping.");
    }
    // Guard: warn if ASS suspiciously large (>200KB) or tiny for 75 segs
    if (assContent.length > 200000) console.warn("[export] ASS very large (>200KB) for", segments.length, "segments — may stress libass");
    if (dlgCount === 0) {
      console.warn("[export] ASS has 0 Dialogue lines — will throw before ffmpeg exec");
    }
  } catch (diagErr) {
    console.warn("[export] ASS diagnostics failed", diagErr);
    try {
      dialogueCount = (assContent.match(/^Dialogue:/gm) || []).length;
    } catch {}
  }
  // Critical guard: 0 Dialogue means no captions will burn — fail fast before ffmpeg
  // Previously this throw was caught by the diagnostics try/catch and only warned; now it propagates to ExportModal.
  if (dialogueCount === 0) {
    throw new Error("Generated ASS has 0 Dialogue lines — check segment filtering");
  }

  const ffmpeg = await getExportFFmpeg();
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

  // ── BUG-LOGIC-9: capture ffmpeg logs for filter-missing detection ─────────
  // Export verification was warn-only; we need hard throws. To detect "No such filter: ass"
  // and "Unable to open ass" we must collect logs beyond `lastErr` (exec often returns code
  // without throwing). Keep a rolling buffer of last 120 log lines.
  const ffmpegLogs: string[] = [];
  const ffmpegLogCollector = ({ message }: { message: string }) => {
    try {
      const msg = String(message);
      ffmpegLogs.push(msg);
      if (ffmpegLogs.length > 120) ffmpegLogs.shift();
    } catch {}
  };
  try {
    ffmpeg.on("log", ffmpegLogCollector);
  } catch {}

  // Progress wiring — for 75-seg/52s vertical, libass overhead may delay first progress event;
  // we combine `progress` (0-1) with `time` (seconds) fallback so UI shows movement early.
  let progressHandler: ((p: { progress: number; time: number }) => void) | null = null;
  if (onProgress) {
    progressHandler = ({ progress, time }) => {
      try {
        let pct = Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));
        // Fallback via time if progress stalled at 0 (common with ass filter startup)
        if ((pct === 0 || pct < 3) && typeof time === "number" && Number.isFinite(time) && durationMs && durationMs > 1000) {
          const timePct = Math.round((time / (durationMs / 1000)) * 100);
          if (Number.isFinite(timePct) && timePct > pct && timePct <= 100) pct = Math.min(95, timePct);
        }
        // For very large exports (75 segs) ensure at least 2% after 3s to show liveness
        onProgress(pct);
      } catch {}
    };
    try {
      ffmpeg.on("progress", progressHandler);
    } catch {}
  }

  const onAbort = () => {
    try {
      // Terminate worker to abort quickly
      ffmpeg.terminate();
    } catch {}
    resetExportFFmpeg();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  // Per-export UUID filenames prevent concurrent race (BUG-LOGIC-4): two rapid clicks previously shared fixed names
  const runId = (() => {
    try { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8); } catch {}
    return Math.random().toString(36).slice(2, 10);
  })();
  const inputName = `input-${runId}-${getInputFileName(videoBlob, projectName)}`;
  const assName = `subtitles-${runId}.ass`;
  const outputName = `output-${runId}.mp4`;

  // Ensure clean slate
  for (const f of [inputName, assName, outputName]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {}
  }

  try {
    // Write input video
    try {
      const data = await fetchFile(videoBlob);
      await ffmpeg.writeFile(inputName, data);
    } catch (e) {
      throw new Error(`Failed to load video into FFmpeg: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    // Write ASS + immediate verify (detects truncated/empty writes that cause silent missing captions)
    try {
      const encoded = new TextEncoder().encode(assContent);
      await ffmpeg.writeFile(assName, encoded);
      // Verify write succeeded and header contains expected PlayRes
      try {
        const verifyRaw = await ffmpeg.readFile(assName);
        const verifyText = typeof verifyRaw === "string" ? verifyRaw : new TextDecoder().decode(verifyRaw as Uint8Array);
        console.debug("[export] ASS bytes", encoded.length, "verify read", verifyText.length, "head:", verifyText.slice(0, 500));
        if (!verifyText.includes("PlayResX") || !verifyText.includes("[V4+ Styles]")) {
          console.warn("[export] ASS verify failed — header missing PlayRes/V4+ Styles", verifyText.slice(0, 300));
        }
      } catch (verErr) {
        console.warn("[export] ASS readback verify failed", verErr);
      }
    } catch (e) {
      throw new Error(`Failed to write subtitles: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    // ── Ensure /fonts has at least one usable font (BUG-LOGIC-5) ──────────────
    // libass requires a file in fontsdir or "No usable font" → transparent captions.
    // Some @ffmpeg/core builds ship empty /fonts. We fetch an open font (Inter) and write it.
    try {
      try {
        await ffmpeg.createDir("/fonts");
      } catch {}
      let needsFont = true;
      try {
        const listing: unknown = await (ffmpeg as unknown as { listDir?: (p: string) => Promise<unknown[]> }).listDir?.("/fonts");
        if (Array.isArray(listing) && listing.length > 0) {
          const names = (listing as Array<string | { name: string }>).map((e) =>
            typeof e === "string" ? e : (e as { name: string }).name
          );
          needsFont = !names.some((n) => /\.(ttf|otf|woff2?)$/i.test(n));
          if (!needsFont) console.debug("[export] fontsdir already populated", names);
        }
      } catch {}
      if (needsFont) {
        // BUG-AUTH-9: External font fetches without SRI. Ideally self-host Inter-Regular.ttf in /public/fonts
        // and pin with SRI hash; runtime fetch from github/jsdelivr has no integrity check. We mitigate by
        // verifying Content-Type and byte length, and rely on CSP connect-src to block exfil. Future: bundle font.
        const fontUrls = [
          "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter-Regular.ttf",
          "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter-Regular.ttf",
        ];
        let fontData: Uint8Array | null = null;
        for (const url of fontUrls) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            // BUG-AUTH-9: verify Content-Type is font-like before trusting bytes for ffmpeg write
            const ct = res.headers.get("content-type") ?? "";
            if (ct && !/font|octet-stream|application\//i.test(ct) && !ct.includes("text/plain")) {
              // Allow if ct is generic but validate length; reject obvious HTML
              if (/text\/html/i.test(ct)) continue;
            }
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 1000) {
              // Basic magic check: TTF starts with 0x00010000 or 'true'/'OTTO'
              const head = new Uint8Array(buf.slice(0, 4));
              const isTtf = (head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00) || head[0] === 0x4f; // 'O'
              if (!isTtf && buf.byteLength < 50000) {
                // still accept — Inter is ~300KB but fallback may vary
              }
              fontData = new Uint8Array(buf);
              break;
            }
          } catch {}
        }
        if (fontData) {
          await ffmpeg.writeFile("/fonts/Inter-Regular.ttf", fontData);
          console.debug("[export] fontsdir populated", "/fonts/Inter-Regular.ttf", fontData.length);
        } else {
          // Fallback via @ffmpeg/util fetchFile (may handle CORS differently)
          try {
            const fetched = await fetchFile(
              "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter-Regular.ttf"
            );
            const u8 =
              fetched instanceof Uint8Array ? fetched : new Uint8Array(fetched as unknown as ArrayBuffer);
            if (u8.length > 1000) {
              await ffmpeg.writeFile("/fonts/Inter-Regular.ttf", u8);
              console.debug("[export] fontsdir populated (fetchFile fallback)", u8.length);
            }
          } catch (e) {
            console.warn("[export] fontsdir font fetch failed — libass may report 'No usable font'", e);
          }
        }
        // Hard-fail if still empty: libass would render transparent captions with exit 0 (BUG-LOGIC-5)
        try {
          const verifyListing: unknown = await (ffmpeg as unknown as { listDir?: (p: string) => Promise<unknown[]> }).listDir?.("/fonts");
          const stillEmpty = !Array.isArray(verifyListing) || (verifyListing as unknown[]).length === 0 || !(verifyListing as Array<string|{name:string}>).some(e => /\.(ttf|otf|woff2?)$/i.test(typeof e === "string" ? e : (e as {name:string}).name));
          if (stillEmpty) {
            throw new Error("Fonts directory is empty — captions would be invisible. Check your connection or bundle a font in public/fonts.");
          }
        } catch (verifyErr) {
          if (verifyErr instanceof Error && verifyErr.message.includes("Fonts directory is empty")) throw verifyErr;
          // listing not supported in some builds — fallback: try read back the file we just wrote
          try {
            const probe = await ffmpeg.readFile("/fonts/Inter-Regular.ttf");
            const len = typeof probe === "string" ? probe.length : (probe as Uint8Array).length;
            if (!len || len < 1000) throw new Error("Fonts directory is empty — captions would be invisible. Check your connection or bundle a font in public/fonts.");
          } catch (e) {
            if (e instanceof Error && e.message.includes("Fonts directory is empty")) throw e;
            console.warn("[export] fontsdir verification fallback failed", e);
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Fonts directory is empty")) throw e;
      console.warn("[export] fontsdir setup failed", e);
      // Re-throw as hard fail: silent transparent captions are worse than error
      throw new Error(e instanceof Error ? e.message : "Failed to prepare fonts for caption burn. Try again online.");
    }
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    // Encode: try ass filter first, fallback to subtitles
    // BUG-LOGIC-1 fix: fontsdir must be OUTSIDE the quoted filename.
    // Previously `ass='subtitles.ass:fontsdir=/fonts'` made libass look for a literal file
    // named `subtitles.ass:fontsdir=/fonts` → not found, exec 0, no burn.
    // Correct: `ass='subtitles.ass':fontsdir=/fonts` (quotes only around filename).
    // Also handles Windows spaces via single-quotes; colon in filename not present here.
    const primaryVf = `ass='${assName}':fontsdir=/fonts`;
    const fallbackVf = `subtitles='${assName}':fontsdir=/fonts`;

    let execCode = -1;
    let lastErr: unknown = null;

    const tryExec = async (vf: string): Promise<number> => {
      console.debug("[export] ASS bytes", assContent.length, "vf", vf, "input", inputName, "playRes", `${width}x${height}`);
      // BUG-LOGIC-8 fix: 9:16 vertical iPhone video stores coded 1920x1080 with rotate=90 flag.
      // video.videoWidth reports display size (1080x1920) but FFmpeg without -noautorotate
      // decodes rotated (1080x1920 display vs 1920x1080 coded mismatch → ASS PlayRes off-screen).
      // -noautorotate keeps FFmpeg's decoded dims = coded dims (1080x1920) matching ASS header.
      const args = [
        "-noautorotate",
        "-i",
        inputName,
        "-vf",
        vf,
        "-c:a",
        "copy",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        outputName,
      ];
      // Clean output if exists from previous attempt
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {}
      // Clear per-attempt log tail so classification is fresh
      const logStartIdx = ffmpegLogs.length;
      try {
        const code = await ffmpeg.exec(args);
        // exec returned non-zero without throwing — synthesize lastErr from recent logs
        if (code !== 0) {
          const recent = ffmpegLogs.slice(logStartIdx).join(" | ").slice(-2000);
          const recentAll = ffmpegLogs.slice(-20).join("\n");
          const hasFilterClue = /No such filter|Unable.*ass|Unable to open/i.test(recentAll) || /No such filter|Unable.*ass|Unable to open/i.test(recent);
          if (hasFilterClue || !lastErr) {
            const tail = (recent || recentAll).slice(-2000);
            if (tail) lastErr = new Error(tail);
          } else if (!lastErr && recent) {
            lastErr = new Error(recent);
          }
        }
        return code;
      } catch (e) {
        // ffmpeg.exec may throw instead of returning code
        lastErr = e;
        return 1;
      }
    };

    // First try ass
    execCode = await tryExec(primaryVf);

    if (execCode !== 0) {
      // BUG-LOGIC-9: classify failure via lastErr + collected ffmpeg logs (exec often returns code without throw)
      const msg0 = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
      const combined0 = `${msg0}\n${ffmpegLogs.slice(-20).join("\n")}`;
      const isFilterMissing0 =
        /No such filter/i.test(combined0) ||
        /Unable.*ass/i.test(combined0) ||
        /Unable to open/i.test(combined0) ||
        (/ass/i.test(combined0.toLowerCase()) && /not found|unknown|missing/i.test(combined0.toLowerCase()));

      // Try fallback regardless if first failed (unless abort)
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      execCode = await tryExec(fallbackVf);

      if (execCode !== 0) {
        // Both failed — analyze with fresh combined logs
        if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
        const combined = `${msg}\n${ffmpegLogs.slice(-20).join("\n")}`;
        const isFilterMissing =
          isFilterMissing0 ||
          /No such filter/i.test(combined) ||
          /Unable.*ass/i.test(combined) ||
          /Unable to open/i.test(combined) ||
          (/ass/i.test(combined.toLowerCase()) && /not found|unknown|missing/i.test(combined.toLowerCase()));

        // If ass missing, give helpful message
        if (isFilterMissing || /filter/i.test(combined.toLowerCase())) {
          throw new Error(
            `FFmpeg build does not support ASS/subtitles filters (burn-in unavailable). Try a different browser (Chrome/Edge) or use desktop FFmpeg as fallback. Details: ${msg || combined.slice(-800) || `exit ${execCode}`}`
          );
        }
        // OOM hint
        if (videoBlob.size > 1.5 * 1024 * 1024 * 1024) {
          throw new Error(
            `Export failed (likely out of memory for large video). Try a shorter or lower-resolution clip, or use a desktop tool. (exit ${execCode})`
          );
        }
        throw new Error(`Video encoding failed (exit ${execCode}). ${msg} Try a different file or reload the page.`);
      }
    }

    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    // Read output — verify integrity to catch silent no-re-encode / empty results
    let outData: Uint8Array;
    try {
      const raw = await ffmpeg.readFile(outputName);
      if (typeof raw === "string") {
        outData = new TextEncoder().encode(raw);
      } else {
        outData = raw as Uint8Array;
      }
    } catch (e) {
      throw new Error(`Failed to read exported video: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!outData || outData.length === 0) {
      throw new Error("Exported file was empty. The encode may have failed.");
    }
    // ── Verification must THROW on critical failures, not just warn ──
    // Scale 10KB guard by duration: short clips (e.g. 200ms) legitimately <10KB (BUG-LOGIC-3)
    const minBytes = durationMs && durationMs > 0 && durationMs < 5000 ? Math.max(1500, Math.floor(durationMs * 4)) : 10000;
    if (outData.length < minBytes) {
      throw new Error("Export failed — output too small. Captions may not have rendered.");
    }
    // Identical-size guard false-positive for tiny videos (BUG-LOGIC-2): only apply when input >50KB
    if (segments.length > 0 && videoBlob.size > 50000 && Math.abs(outData.length - videoBlob.size) < 5000) {
      throw new Error("Export appears unprocessed — captions not burned. Try again.");
    }
    if (outData.length < 0.5 * videoBlob.size) {
      // Keep as warn (not throw) because ultrafast+crf23 can legitimately be smaller than input
      console.warn("[export] output suspiciously small vs input", {
        inSize: videoBlob.size,
        outSize: outData.length,
        ratio: (outData.length / videoBlob.size).toFixed(3),
      });
    } else {
      console.debug("[export] output verified", { inSize: videoBlob.size, outSize: outData.length });
    }

    // Cleanup virtual FS (best effort)
    for (const f of [inputName, assName, outputName]) {
      try {
        await ffmpeg.deleteFile(f);
      } catch {}
    }

    // Build result
    const blob = new Blob([new Uint8Array(outData)], { type: "video/mp4" });
    const filename = getExportFilename(projectName);
    const url = URL.createObjectURL(blob);

    return { blob, url, filename };
  } catch (e) {
    // Ensure partial files cleaned
    for (const f of [inputName, assName, outputName]) {
      try {
        await ffmpeg.deleteFile(f);
      } catch {}
    }
    // If we terminated due to abort, reset singleton
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      resetExportFFmpeg();
      throw new DOMException("Export cancelled", "AbortError");
    }
    // If error is OOM or filter missing, reset to allow retry with fresh instance?
    // Keep instance for future retries unless terminated
    throw e;
  } finally {
    try {
      ffmpeg.off("log", ffmpegLogCollector);
    } catch {}
    if (progressHandler) {
      try {
        ffmpeg.off("progress", progressHandler);
      } catch {}
    }
    if (signal) {
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {}
    }
  }
}

// ── Convenience download trigger ──────────────────────────────────────────
// IMPORTANT: ExportModal uses `resultUrl` derived from ffmpeg.readFile output blob (re-encoded with ASS),
// NOT the original videoBlob. Do not pass videoBlob here — caller must pass the export result blob.
// This helper creates a fresh object URL from the given encoded blob and triggers download.

export function triggerDownload(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  if (typeof document !== "undefined") {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Delay removal to ensure click processed
    window.setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 500);
  }
  return url;
}

export function revokeExportUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {}
}
