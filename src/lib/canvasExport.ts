/**
 * CapAI — Canvas burn engine (wasm-free)
 * Guarantees captions at 0:05 for 75-seg Bold 1080x1920 via
 * <video> + offscreen canvas + canvas.captureStream + MediaRecorder.
 *
 * No FFmpeg.wasm fetch — works offline on Windows Chrome.
 * Primary engine for ExportModal; FFmpeg is fallback only.
 */

import type { CaptionSegment, CaptionStyle } from "./types";
import { renderCaption } from "./canvasRenderer";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CanvasExportOptions {
  videoBlob: Blob;
  segments: CaptionSegment[];
  style: CaptionStyle;
  mode: "dynamic" | "static";
  videoWidth: number;
  videoHeight: number;
  durationMs: number;
  projectName?: string;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface CanvasExportResult {
  blob: Blob;
  url: string;
  filename: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sanitizeBase(name: string): string {
  const raw = (name || "video").trim() || "video";
  const base = raw.replace(/\.[^/.]+$/, "");
  const sanitized = base.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "video";
  return sanitized.length > 80 ? sanitized.slice(0, 80) : sanitized;
}

function getCanvasExportFilename(projectName: string | undefined, mimeType: string): string {
  const base = sanitizeBase(projectName || "video");
  const mt = (mimeType || "").toLowerCase();
  // Prefer webm for VP9/VP8, mp4 only if explicit mp4
  let ext = "webm";
  if (mt.includes("mp4") || mt.includes("avc") || mt.includes("h264")) ext = "mp4";
  else if (mt.includes("webm") || mt.includes("vp9") || mt.includes("vp8") || mt.includes("opus")) ext = "webm";
  else if (mt === "video/mp4") ext = "mp4";
  // Stabilize: if mime is empty, default webm
  return `${base}_captioned.${ext}`;
}

function pickSupportedMimeType(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function isCanvasExportSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof window === "undefined") return false;
  if (!("MediaRecorder" in window)) return false;
  const canvas = document.createElement("canvas");
  const hasCapture =
    typeof (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream ===
    "function";
  if (!hasCapture) return false;
  return pickSupportedMimeType() !== null;
}

// Find active segment at time — matches canvasRenderer grace logic (single-pass)
function findActiveSegment(segments: CaptionSegment[], tMs: number): CaptionSegment | null {
  let graceFallback: CaptionSegment | null = null;
  for (const s of segments) {
    if (tMs >= s.startMs && tMs <= s.endMs) return s; // core hit — immediate
    if (!graceFallback && tMs >= s.startMs - 60 && tMs <= s.endMs + 60) {
      graceFallback = s; // remember first grace match
    }
  }
  return graceFallback;
}

// ── Main export ───────────────────────────────────────────────────────────

export async function exportViaCanvas(options: CanvasExportOptions): Promise<CanvasExportResult> {
  const { videoBlob, segments, style, mode, videoWidth, videoHeight, durationMs, projectName, onProgress, signal } =
    options;

  if (!videoBlob || videoBlob.size === 0) {
    throw new Error("No video data available. Re-upload the video and try again.");
  }
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  if (!segments || segments.length === 0) {
    throw new Error("No captions to burn. Add captions before exporting.");
  }
  if (!videoWidth || !videoHeight || videoWidth < 320 || videoHeight < 240) {
    throw new Error("Could not detect video dimensions. Please try again.");
  }
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Canvas export is only available in the browser.");
  }
  // Feature detection — guarantee clear fallback path
  if (!isCanvasExportSupported()) {
    // Detailed message helps modal decide fallback
    const hasRecorder = typeof window !== "undefined" && "MediaRecorder" in window;
    const canvas = document.createElement("canvas");
    const hasCapture =
      typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream === "function";
    const mime = pickSupportedMimeType();
    throw new Error(
      `Canvas burn unavailable (MediaRecorder:${hasRecorder} captureStream:${hasCapture} mime:${mime ?? "none"}). Falling back to FFmpeg.`
    );
  }

  const w = Math.round(videoWidth);
  const h = Math.round(videoHeight);
  const totalDur = durationMs && durationMs > 0 ? durationMs : 0;

  console.debug("[export] canvas burn started", {
    dims: `${w}x${h}`,
    isPortrait: h > w,
    segments: segments.length,
    mode,
    font: style.fontFamily,
    size: style.fontSize,
    preset: style.preset,
    durationMs: totalDur,
  });

  // ── 1) Hidden video element ──────────────────────────────────────────
  const videoUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true; // required for autoplay without gesture issues
  (video as unknown as { playsInline: boolean }).playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  // Hidden positioning for Safari metadata requirements
  video.style.position = "fixed";
  video.style.left = "-99999px";
  video.style.top = "-99999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  // Append to DOM for Safari/Chrome consistency
  try {
    document.body.appendChild(video);
  } catch {
    // ignore append failure
  }

  // Will be populated during setup
  let mainCanvas: HTMLCanvasElement | null = null;
  let captionCanvas: HTMLCanvasElement | null = null;
  let captionCtx: CanvasRenderingContext2D | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let stream: MediaStream | null = null;
  let combinedStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let rafId = 0;
  let aborted = false;

  const cleanup = () => {
    try {
      if (rafId) cancelAnimationFrame(rafId);
    } catch {}
    rafId = 0;
    try {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
    } catch {}
    try {
      video.pause();
    } catch {}
    try {
      video.removeAttribute("src");
      video.load();
    } catch {}
    try {
      if (video.parentNode) video.parentNode.removeChild(video);
    } catch {}
    try {
      URL.revokeObjectURL(videoUrl);
    } catch {}
    // Stop tracks
    const stopTracks = (s: MediaStream | null) => {
      if (!s) return;
      try {
        for (const t of s.getTracks()) {
          try {
            t.stop();
          } catch {}
        }
      } catch {}
    };
    // Avoid double-stop same tracks in both streams
    if (combinedStream && stream && combinedStream !== stream) {
      stopTracks(combinedStream);
      // stream tracks may share video tracks; but already stopped via combined — safe
      try {
        for (const t of stream.getAudioTracks()) {
          try {
            t.stop();
          } catch {}
        }
      } catch {}
    } else {
      stopTracks(stream);
      stopTracks(combinedStream);
    }
    // Remove canvases
    try {
      if (mainCanvas && mainCanvas.parentNode) mainCanvas.parentNode.removeChild(mainCanvas);
    } catch {}
    try {
      if (captionCanvas && captionCanvas.parentNode) captionCanvas.parentNode.removeChild(captionCanvas);
    } catch {}
  };

  // Signal wiring
  const onSignalAbort = () => {
    aborted = true;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {}
    try {
      video.pause();
    } catch {}
  };
  if (signal) {
    if (signal.aborted) {
      cleanup();
      throw new DOMException("Export cancelled", "AbortError");
    }
    signal.addEventListener("abort", onSignalAbort, { once: true });
  }

  try {
    // ── Wait for loadedmetadata (8s timeout) ───────────────────────────
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Timed out loading video metadata (8s). Please try again or re-upload."));
      }, 8000);

      const onMeta = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        // Validate reported dims — spec says videoWidth 1080, height 1920 duration 52.1 but we already have opts
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const d = Number.isFinite(video.duration) && video.duration !== Infinity ? video.duration * 1000 : 0;
        console.debug("[export] canvas video meta", { vw, vh, durationSec: video.duration, d, expected: `${w}x${h}` });
        resolve();
      };
      const onErr = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(new Error("Failed to load video for canvas burn. Try re-uploading."));
      };
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      video.addEventListener("error", onErr, { once: true });
      // Edge: if already ready
      if (video.readyState >= 1 && video.videoWidth > 0) {
        window.clearTimeout(timeoutId);
        if (!settled) {
          settled = true;
          console.debug("[export] canvas video already loaded", video.videoWidth, video.videoHeight);
          resolve();
        }
      }
      try {
        video.load();
      } catch {
        window.clearTimeout(timeoutId);
        if (!settled) {
          settled = true;
          reject(new Error("Failed to load video element."));
        }
      }
      // Abort path also rejects
      if (signal) {
        const abortHandler = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onErr);
          reject(new DOMException("Export cancelled", "AbortError"));
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    if (signal?.aborted || aborted) throw new DOMException("Export cancelled", "AbortError");

    // ── 2) Offscreen canvas at actual video resolution ─────────────────
    mainCanvas = document.createElement("canvas");
    mainCanvas.width = w;
    mainCanvas.height = h;
    // Keep offscreen but appended hidden for captureStream reliability
    mainCanvas.style.position = "fixed";
    mainCanvas.style.left = "-99999px";
    mainCanvas.style.top = "-99999px";
    mainCanvas.style.width = "1px";
    mainCanvas.style.height = "1px";
    mainCanvas.style.opacity = "0";
    mainCanvas.style.pointerEvents = "none";
    try {
      document.body.appendChild(mainCanvas);
    } catch {}
    ctx = mainCanvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Failed to get 2D context for burn canvas.");

    // Second canvas for caption rendering (avoids clearRect wiping video)
    captionCanvas = document.createElement("canvas");
    captionCanvas.width = w;
    captionCanvas.height = h;
    captionCanvas.style.position = "fixed";
    captionCanvas.style.left = "-99999px";
    captionCanvas.style.top = "-99999px";
    captionCtx = captionCanvas.getContext("2d", { alpha: true });
    if (!captionCtx) throw new Error("Failed to get caption canvas context.");

    // Prime canvas with black to ensure it has content before captureStream
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

    // ── 4) Capture stream (30fps) ─────────────────────────────────────
    const canvasWithCapture = mainCanvas as HTMLCanvasElement & {
      captureStream?: (fps: number) => MediaStream;
    };
    if (typeof canvasWithCapture.captureStream !== "function") {
      throw new Error("canvas.captureStream is not supported in this browser.");
    }
    stream = canvasWithCapture.captureStream(30);
    if (!stream || stream.getVideoTracks().length === 0) {
      throw new Error("Failed to capture canvas stream.");
    }
    console.debug("[export] canvas stream tracks", stream.getVideoTracks().length, "fps 30");

    // ── 8) Audio: combine canvas video + video element audio ──────────
    combinedStream = stream;
    try {
      const videoAny = video as unknown as {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      let audioSrc: MediaStream | null = null;
      if (typeof videoAny.captureStream === "function") {
        try {
          audioSrc = videoAny.captureStream();
        } catch (e) {
          console.warn("[export] video.captureStream failed", e);
        }
      } else if (typeof videoAny.mozCaptureStream === "function") {
        try {
          audioSrc = videoAny.mozCaptureStream();
        } catch (e) {
          console.warn("[export] video.mozCaptureStream failed", e);
        }
      }
      if (audioSrc) {
        const audioTracks = audioSrc.getAudioTracks();
        console.debug("[export] audio tracks from video", audioTracks.length);
        if (audioTracks.length > 0) {
          // Chrome: video.captureStream may include a video track plus audio — we only want audio
          // combined = canvas video + video audio
          combinedStream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
        } else {
          // No audio tracks — maybe video has no audio; keep canvas-only (will be silent)
          console.warn("[export] no audio tracks from video.captureStream — output will be silent");
        }
      } else {
        console.warn("[export] video captureStream unavailable — output will be silent (no AudioContext fallback)");
      }
    } catch (e) {
      console.warn("[export] audio combine failed — proceeding silent", e);
      combinedStream = stream;
    }

    // ── 5) MediaRecorder mime selection ────────────────────────────────
    const mimeType = pickSupportedMimeType();
    if (!mimeType) throw new Error("No supported MediaRecorder mimeType (vp9/vp8/webm/mp4).");
    console.debug("[export] canvas mime selected", mimeType);

    const mimeLower = mimeType.toLowerCase();
    const isWebM = mimeLower.includes("webm");
    const bitsPerSecond = w * h > 1280 * 720 ? 8_000_000 : 5_000_000; // 8 Mbps for 1080x1920, 5 Mbps otherwise

    const recorderOptions: MediaRecorderOptions & { videoBitsPerSecond?: number } = {};
    (recorderOptions as unknown as { mimeType: string }).mimeType = mimeType;
    // Only set bits if webm/vp9; mp4 may ignore
    if (isWebM) {
      try {
        (recorderOptions as unknown as { videoBitsPerSecond: number }).videoBitsPerSecond = bitsPerSecond;
      } catch {}
    }

    try {
      recorder = new MediaRecorder(combinedStream, recorderOptions as MediaRecorderOptions);
    } catch (e) {
      // Retry without bits
      console.warn("[export] MediaRecorder with bits failed, retry without", e);
      recorder = new MediaRecorder(combinedStream, { mimeType } as MediaRecorderOptions);
    }

    // ── Collect chunks ────────────────────────────────────────────────
    const chunks: BlobPart[] = [];
    const recorderDone = new Promise<Blob>((resolveRec, rejectRec) => {
      if (!recorder) {
        rejectRec(new Error("Recorder not initialized"));
        return;
      }
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev: Event) => {
        const err = (ev as unknown as { error?: Error }).error;
        rejectRec(err || new Error("MediaRecorder error"));
      };
      recorder.onstop = () => {
        try {
          const blobType = recorder?.mimeType || mimeType;
          const blob = new Blob(chunks, { type: blobType });
          if (!blob || blob.size === 0) {
            rejectRec(new Error("Recorder produced empty output."));
            return;
          }
          resolveRec(blob);
        } catch (err) {
          rejectRec(err instanceof Error ? err : new Error(String(err)));
        }
      };
      // Abort-reject path
      if (signal) {
        const onAbortStop = () => {
          try {
            if (recorder && recorder.state !== "inactive") recorder.stop();
          } catch {}
          rejectRec(new DOMException("Export cancelled", "AbortError"));
        };
        if (signal.aborted) onAbortStop();
        // onSignalAbort already wired above
      }
    });

    // Ensure video ready to play from start
    // Seek to 0 and wait for seeked
    await new Promise<void>((res, rej) => {
      if (signal?.aborted) {
        rej(new DOMException("Export cancelled", "AbortError"));
        return;
      }
      let done = false;
      const to = window.setTimeout(() => {
        if (done) return;
        done = true;
        res(); // don't block export if seeked never fires
      }, 1500);
      const onSeeked = () => {
        if (done) return;
        done = true;
        window.clearTimeout(to);
        res();
      };
      const onError = () => {
        if (done) return;
        done = true;
        window.clearTimeout(to);
        rej(new Error("Failed to seek video to start"));
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      try {
        video.currentTime = 0;
      } catch (e) {
        window.clearTimeout(to);
        if (!done) {
          done = true;
          rej(e instanceof Error ? e : new Error(String(e)));
        }
      }
      if (signal) {
        const a = () => {
          if (done) return;
          done = true;
          window.clearTimeout(to);
          rej(new DOMException("Export cancelled", "AbortError"));
        };
        if (signal.aborted) a();
        else signal.addEventListener("abort", a, { once: true });
      }
    });

    if (signal?.aborted || aborted) throw new DOMException("Export cancelled", "AbortError");

    // Draw first frame before recorder starts to avoid black first frame
    try {
      // If video has current frame, draw it
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, w, h);
        // Caption for t=0
        const t0 = 0;
        const seg0 = findActiveSegment(segments, t0);
        if (captionCtx) {
          captionCtx.clearRect(0, 0, w, h);
          renderCaption(captionCtx, seg0, style, t0, mode, w, h);
          ctx.drawImage(captionCanvas, 0, 0, w, h);
        }
      }
    } catch (e) {
      console.warn("[export] initial frame draw failed", e);
    }

    // ── 6) Playback loop (real-time 1x) ───────────────────────────────
    // Must report progress via onProgress using currentTime/duration

    // rAF draw loop — draws video + captions each frame
    let lastProgress = -1;
    const reportProgress = (nowMs: number) => {
      if (!onProgress) return;
      const dur = totalDur > 0 ? totalDur : video.duration * 1000 || totalDur;
      if (!dur || dur <= 0) return;
      const pct = Math.min(99, Math.max(0, Math.round((nowMs / dur) * 100)));
      if (pct !== lastProgress && pct > lastProgress) {
        lastProgress = pct;
        try {
          onProgress(pct);
        } catch {}
      }
    };

    const drawLoop = () => {
      if (aborted || signal?.aborted) return;
      if (video.ended) return;
      if (video.paused) {
        // Still schedule if paused but not ended? but we pause only on abort
        return;
      }
      try {
        ctx!.drawImage(video, 0, 0, w, h);
        const nowMs = video.currentTime * 1000;
        const active = findActiveSegment(segments, nowMs);
        if (captionCtx) {
          captionCtx.clearRect(0, 0, w, h);
          // renderCaption clears internally but we already cleared caption layer; safe to call
          renderCaption(captionCtx, active, style, nowMs, mode, w, h);
          ctx!.drawImage(captionCanvas!, 0, 0, w, h);
        }
        reportProgress(nowMs);
      } catch (e) {
        console.warn("[export] drawFrame error", e);
      }
      // Continue loop while playing
      if (!video.ended && !video.paused && !aborted && !signal?.aborted) {
        rafId = requestAnimationFrame(drawLoop);
      }
    };

    // Start recording then play
    // Use timeslice 100ms per spec bullet 6/7
    try {
      recorder.start(100);
      console.debug("[export] MediaRecorder started", mimeType, "state", recorder.state);
    } catch (e) {
      throw new Error(`MediaRecorder.start failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Wire video ended -> stop recorder
    const endedPromise = new Promise<void>((res, rej) => {
      const onEnded = () => res();
      const onErr = () => rej(new Error("Video playback error during burn"));
      const onAbort = () => rej(new DOMException("Export cancelled", "AbortError"));
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onErr, { once: true });
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      // Also timeout guard: if video stalls longer than duration+10s, force stop
      const durSec = totalDur > 0 ? totalDur / 1000 : video.duration || 60;
      const guard = window.setTimeout(() => {
        // If still not ended after dur+12s, assume hang and force stop
        if (!video.ended && !aborted) {
          console.warn("[export] video ended guard timeout", durSec);
          try {
            video.pause();
          } catch {}
          res();
        }
      }, (durSec + 12) * 1000);
      // Clear guard on ended
      video.addEventListener(
        "ended",
        () => window.clearTimeout(guard),
        { once: true }
      );
    });

    // Start RAF loop and playback
    rafId = requestAnimationFrame(drawLoop);

    let playError: unknown = null;
    try {
      // Ensure we are at 0
      // playbackRate 1x (spec: acceptable wall 52s)
      video.playbackRate = 1.0;
      await video.play();
      console.debug("[export] video.play() started", video.currentTime, video.duration);
    } catch (e) {
      playError = e;
      console.warn("[export] video.play() failed — fallback to seek-frame loop", e);
      // Fallback: manual seek loop (non-real-time) could be implemented, but for now throw to fallback FFmpeg
      // However try to continue: if play blocked, attempt to still record via manual seeks
      // For guarantee we need a path: implement manual seek-draw for cases where autoplay blocked
      // We'll attempt a manual seek-draw loop that still feeds captureStream via timing wait
      // This is complex with MediaRecorder realtime, so we reject to allow FFmpeg fallback
      // But check if error is AbortError then propagate
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      // For NotAllowedError, we can consider throwing with message leading to FFmpeg fallback
      throw new Error(
        `Video playback blocked by browser (autoplay). Please try again via click. Details: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (playError) throw playError;

    // Wait for video to end (real-time)
    try {
      await endedPromise;
    } catch (e) {
      // If ended promise rejected due to abort, propagate
      throw e;
    }

    // Stop recorder — onstop will resolve recorderDone
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
        console.debug("[export] recorder stop requested, state", recorder.state);
      } catch (e) {
        console.warn("[export] recorder.stop failed", e);
      }
    }
    // Cancel RAF — recorderDone will handle after small delay
    try {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } catch {}

    // Await blob
    const blob = await recorderDone;
    console.debug("[export] canvas blob done", blob.size, blob.type);

    if (signal?.aborted || aborted) throw new DOMException("Export cancelled", "AbortError");
    // Scale threshold by duration: short clips (e.g. 200ms) legitimately <10KB
    const minBytes = totalDur > 0 && totalDur < 5000 ? Math.max(1500, Math.floor(totalDur * 4)) : 10000;
    if (!blob || blob.size < minBytes) {
      throw new Error("Export failed — output too small. Captions may not have rendered.");
    }

    // Final progress 100
    try {
      if (onProgress) onProgress(100);
    } catch {}

    const filename = getCanvasExportFilename(projectName || "video", blob.type || mimeType);
    const url = URL.createObjectURL(blob);

    console.debug("[export] canvas burn finished", { filename, size: blob.size, mime: blob.type });

    return { blob, url, filename };
  } catch (e) {
    // Cancel RAF + recorder if still running
    try {
      if (rafId) cancelAnimationFrame(rafId);
    } catch {}
    try {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
    } catch {}
    throw e;
  } finally {
    // Remove signal listener
    if (signal) {
      try {
        signal.removeEventListener("abort", onSignalAbort);
      } catch {}
    }
    // Allow short delay before cleanup so blob url creation done? But we already created blob url before cleanup.
    // Cleanup video/canvas/streams — note: we must NOT revoke output url (returned to caller)
    // We already revoke videoUrl and stop tracks
    // Do cleanup of intermediates
    try {
      // keep main behavior: stop tracks + remove elements
      // Use the cleanup fn but avoid double revoke of output url
      cleanup();
    } catch {}
  }
}

export { pickSupportedMimeType, getCanvasExportFilename, isCanvasExportSupported };
