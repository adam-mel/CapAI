"use client";

/* eslint-disable react-hooks/set-state-in-effect -- export modal syncs props to local state for dims/progress */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionSegment, CaptionStyle } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { exportVideo, getExportFilename, resetExportFFmpeg, getVideoMetadata } from "@/lib/export";
import { exportViaCanvas } from "@/lib/canvasExport";

type ExportStep = 1 | 2 | 3;

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  durationMs: number;
  mode: "dynamic" | "static";
  highlightStyle?: CaptionStyle["highlightStyle"];
  segments: CaptionSegment[];
  style: CaptionStyle;
  videoBlob: Blob | null;
  videoWidth?: number;
  videoHeight?: number;
}

export default function ExportModal({
  isOpen,
  onClose,
  projectName,
  durationMs,
  mode,
  highlightStyle,
  segments,
  style,
  videoBlob,
  videoWidth,
  videoHeight,
}: ExportModalProps) {
  const [step, setStep] = useState<ExportStep>(1);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultFilename, setResultFilename] = useState<string>("");
  const [resolvedWidth, setResolvedWidth] = useState<number | undefined>(videoWidth);
  const [resolvedHeight, setResolvedHeight] = useState<number | undefined>(videoHeight);
  const [resolvedDur, setResolvedDur] = useState<number>(durationMs);
  const abortRef = useRef<AbortController | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync resolved dims when props change
  useEffect(() => {
    setResolvedWidth(videoWidth);
    setResolvedHeight(videoHeight);
  }, [videoWidth, videoHeight]);

  useEffect(() => {
    setResolvedDur(durationMs);
  }, [durationMs]);

  // Fetch video metadata if dims missing and modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (resolvedWidth && resolvedHeight) return;
    if (!videoBlob) return;
    let cancelled = false;
    (async () => {
      try {
        const meta = await getVideoMetadata(videoBlob);
        if (cancelled) return;
        if (!resolvedWidth) setResolvedWidth(meta.width);
        if (!resolvedHeight) setResolvedHeight(meta.height);
        if (!resolvedDur || resolvedDur === 0) setResolvedDur(meta.durationMs);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, videoBlob, resolvedWidth, resolvedHeight, resolvedDur]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      try {
        resetExportFFmpeg();
      } catch {}
      abortRef.current = null;
    }
    setProgress(0);
    setError("Export cancelled.");
    setStep(1);
  }, []);

  // Reset on open / close
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setProgress(0);
      setError(null);
      // Keep previous result until new export? Clear for fresh flow
      // But if coming from step3, we keep result for re-download.
      // On open, if previous result exists but blob mismatched, clear?
      // We'll not clear resultBlob/url here to allow Export Again flow; but for fresh open after close, clear.
      // So only reset if we were closed fully: we track with a flag
    } else {
      // when closed, abort if running
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {}
        try {
          resetExportFFmpeg();
        } catch {}
        abortRef.current = null;
      }
      // delay clearing to allow exit animation, then clean
      const t = window.setTimeout(() => {
        setProgress(0);
        setError(null);
        setStep(1);
        // do not revoke url immediately? Revoke when new export starts or unmount
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  // Body scroll lock with counter (UI-21) — supports multiple modals
  useEffect(() => {
    if (!isOpen) return;
    const key = "export-modal";
    const g = globalThis as unknown as { __capaiLockCount?: number; __capaiLockPrev?: string };
    g.__capaiLockCount = (g.__capaiLockCount ?? 0) + 1;
    if (g.__capaiLockCount === 1) {
      g.__capaiLockPrev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      const gg = globalThis as unknown as { __capaiLockCount?: number; __capaiLockPrev?: string };
      gg.__capaiLockCount = Math.max(0, (gg.__capaiLockCount ?? 1) - 1);
      if (gg.__capaiLockCount === 0) {
        document.body.style.overflow = gg.__capaiLockPrev ?? "";
      }
    };
  }, [isOpen]);

  // Revoke url on unmount or when new export
  useEffect(() => {
    return () => {
      if (resultUrl) {
        try {
          URL.revokeObjectURL(resultUrl);
        } catch {}
      }
    };
  }, [resultUrl]);

  // Esc to close (except when exporting in step2, esc triggers cancel)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (step === 2) {
          handleCancel();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, step, onClose, handleCancel]);

  const wordCount = useMemo(() => {
    let c = 0;
    for (const s of segments) c += s.words?.length ?? s.text.trim().split(/\s+/).filter(Boolean).length;
    return c;
  }, [segments]);

  // UI-22 hydration fix: init null on SSR, hydrate client value in effect to avoid mismatch
  const [filenamePreviewClient, setFilenamePreviewClient] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && typeof MediaRecorder !== "undefined") {
        const webmSupported =
          MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ||
          MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ||
          MediaRecorder.isTypeSupported("video/webm");
        if (webmSupported) {
          const raw = (projectName || "video").trim() || "video";
          const base = raw.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "video";
          const truncated = base.length > 80 ? base.slice(0, 80) : base;
          setFilenamePreviewClient(`${truncated}_captioned.webm`);
          return;
        }
      }
    } catch {}
    setFilenamePreviewClient(getExportFilename(projectName || "video"));
  }, [projectName]);
  const filenamePreview = filenamePreviewClient ?? getExportFilename(projectName || "video");

  const durationLabel = useMemo(() => {
    if (resolvedDur && resolvedDur > 0) return formatDuration(resolvedDur);
    if (durationMs && durationMs > 0) return formatDuration(durationMs);
    return "—";
  }, [resolvedDur, durationMs]);

  const modeLabel = useMemo(() => {
    if (mode === "static") return "Static";
    const hl = highlightStyle ?? style.highlightStyle;
    const hlLabel =
      hl === "karaoke" ? "Karaoke highlight" : hl === "pill" ? "Pill highlight" : hl === "pop" ? "Pop & Scale" : "Highlight";
    return `Dynamic · ${hlLabel}`;
  }, [mode, highlightStyle, style.highlightStyle]);

  const resolutionLabel = useMemo(() => {
    if (resolvedWidth && resolvedHeight) return `${resolvedWidth}×${resolvedHeight}`;
    return "Original";
  }, [resolvedWidth, resolvedHeight]);

  const [canvasFormatLabelClient, setCanvasFormatLabelClient] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && typeof MediaRecorder !== "undefined") {
        const cands = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"] as const;
        for (const c of cands) {
          if (MediaRecorder.isTypeSupported(c)) {
            if (c.includes("vp9")) { setCanvasFormatLabelClient("WebM (VP9) burned"); return; }
            if (c.includes("vp8")) { setCanvasFormatLabelClient("WebM (VP8) burned"); return; }
            if (c.includes("webm")) { setCanvasFormatLabelClient("WebM burned"); return; }
            if (c.includes("mp4")) { setCanvasFormatLabelClient("MP4 (canvas) burned"); return; }
          }
        }
      }
    } catch {}
    setCanvasFormatLabelClient("WebM (VP9) burned");
  }, []);
  const canvasFormatLabel = canvasFormatLabelClient ?? "WebM (VP9) burned";

  const fileSizeLabel = useMemo(() => {
    if (!videoBlob) return null;
    const bytes = videoBlob.size;
    if (bytes === 0) return null;
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }, [videoBlob]);

  const isLargeFile = useMemo(() => videoBlob ? videoBlob.size > 2 * 1024 * 1024 * 1024 : false, [videoBlob]);

  // UI-21: handleClose wired to overlay clicks
  const handleClose = useCallback(() => {
    if (step === 2) {
      handleCancel();
    }
    onClose();
  }, [step, handleCancel, onClose]);

  const handleStartExport = useCallback(async () => {
    if (!videoBlob) {
      setError("No video data found. Please re-upload the video.");
      return;
    }
    if (segments.length === 0) {
      setError("No captions to burn. Add captions before exporting.");
      return;
    }
    setError(null);
    setProgress(0);
    setStep(2);

    // Revoke old url if exists
    if (resultUrl) {
      try {
        URL.revokeObjectURL(resultUrl);
      } catch {}
      setResultUrl(null);
      setResultBlob(null);
    }

    const ac = new AbortController();
    abortRef.current = ac;

    // Resolve dims if still missing — no silent fallback to 1280x720
    let w = resolvedWidth;
    let h = resolvedHeight;
    let dur = resolvedDur || durationMs;
    if ((!w || !h) && videoBlob) {
      try {
        const meta = await getVideoMetadata(videoBlob);
        w = w || meta.width;
        h = h || meta.height;
        dur = dur || meta.durationMs;
        setResolvedWidth(w);
        setResolvedHeight(h);
        setResolvedDur(dur);
      } catch (e) {
        // getVideoMetadata now throws on failure (8s timeout) instead of silently returning 1280x720
        console.warn("[export] getVideoMetadata failed in ExportModal", e);
      }
    }

    // Ensure w/h required, no silent fallback to 1280x720
    if (!w || !h) {
      setError("Could not detect video dimensions. Please try again.");
      setStep(1);
      return;
    }
    if (w < 320 || h < 240) {
      setError("Could not detect video dimensions. Please try again.");
      setStep(1);
      return;
    }

    console.debug("[export] dims", w, h, "segments", segments.length, "mode", mode, "font", style.fontFamily, "size", style.fontSize, "preset", style.preset);

    // Extra warning for 75-seg portrait case: ensure PlayRes matches vertical expectation
    if (segments.length > 50) {
      console.debug("[export] large segment export", {
        count: segments.length,
        dims: `${w}x${h}`,
        isPortrait: h > w,
        mode,
        font: style.fontFamily,
        color: style.color,
        highlight: style.highlightStyle,
      });
      if (w > h) console.warn("[export] expected portrait but w>h — dims may be swapped, captions off-screen risk");
    }
    // Abort guard: large 75-seg exports at ultrafast+crf23 take ~60-90s for 52s 1080x1920; warn if duration long
    if (segments.length > 50 && dur && dur > 40000) {
      console.debug("[export] long video + many segments, expect ~90s encode");
    }

    try {
      // ── PRIMARY: canvas burn (wasm-free) — guarantees captions at 0:05 for 75-seg Bold 1080x1920 ──
      console.debug("[export] canvas burn started", { w, h, dur, segments: segments.length, mode });
      let canvasSucceeded = false;
      try {
        const canvasRes = await exportViaCanvas({
          videoBlob,
          segments,
          style,
          mode,
          videoWidth: w,
          videoHeight: h,
          durationMs: dur,
          projectName: projectName || "video",
          signal: ac.signal,
          onProgress: (pct) => {
            setProgress((prev) => (pct > prev ? pct : prev));
          },
        });
        if (ac.signal.aborted) return;
        console.debug("[export] canvas burn finished", canvasRes.filename, canvasRes.blob.size, canvasRes.blob.type);
        setResultBlob(canvasRes.blob);
        setResultUrl(canvasRes.url);
        setResultFilename(canvasRes.filename);
        setProgress(100);
        setStep(3);
        canvasSucceeded = true;
        return;
      } catch (canvasErr) {
        if (ac.signal.aborted || (canvasErr instanceof DOMException && canvasErr.name === "AbortError")) {
          setError("Export cancelled.");
          setStep(1);
          return;
        }
        console.warn("[export] canvas burn failed, falling back to FFmpeg", canvasErr);
        // Fall through to FFmpeg fallback — do not return yet
        // For capability errors the canvas engine already threw a descriptive message;
        // FFmpeg fallback will attempt to recover (FFmpeg.wasm may still fail on Windows with ERR_SSL_PROTOCOL_ERROR 32MB).
      }

      if (canvasSucceeded) return;

      // ── FALLBACK: FFmpeg.wasm (requires 32MB wasm fetch — may fail with ERR_SSL_PROTOCOL_ERROR on Windows) ──
      console.debug("[export] FFmpeg fallback started");
      const res = await exportVideo({
        videoBlob,
        segments,
        style,
        mode,
        projectName: projectName || "video",
        videoWidth: w,
        videoHeight: h,
        durationMs: dur,
        signal: ac.signal,
        onProgress: (pct) => {
          // Ensure monotonic
          setProgress((prev) => (pct > prev ? pct : prev));
        },
      });
      if (ac.signal.aborted) return;
      setResultBlob(res.blob);
      setResultUrl(res.url);
      setResultFilename(res.filename);
      setProgress(100);
      setStep(3);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        setError("Export cancelled.");
        setStep(1);
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      // If canvas failed and FFmpeg also failed, surface combined hint
      const hint = msg.includes("FFmpeg") && msg.includes("ERR_SSL") ? " (canvas fallback also attempted)" : "";
      setError((msg || "Export failed. Please try again.") + hint);
      setStep(1);
    } finally {
      abortRef.current = null;
    }
  }, [videoBlob, segments, style, mode, projectName, resolvedWidth, resolvedHeight, resolvedDur, durationMs, resultUrl]);

  const handleDownload = useCallback(() => {
    if (!resultBlob || !resultUrl) return;
    const filename = resultFilename || filenamePreview;
    // Trigger via anchor even though we have url
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 400);
  }, [resultBlob, resultUrl, resultFilename, filenamePreview]);

  const handleExportAgain = useCallback(() => {
    setError(null);
    setProgress(0);
    setStep(1);
    // Keep blob/url for possible re-download but will be revoked on next export start
  }, []);

  const handleBackToEditor = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  // Step 2 is full-screen overlay per PRD — light editorial
  if (step === 2) {
    return (
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[var(--canvas)]/85 backdrop-blur-[8px] p-6 animate-[fadeIn_180ms_ease-out]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-progress-title"
      >
        <div className="relative flex flex-col items-center gap-6 text-center rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] p-8 shadow-[var(--shadow-elevated)] overflow-hidden max-w-[360px] w-full">
          {/* subtle orbs */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.16)_0%,transparent_70%)]" aria-hidden />
          <div className="pointer-events-none absolute -left-10 -bottom-10 h-24 w-24 rounded-full bg-[radial-gradient(circle_at_center,rgba(244,197,168,0.14)_0%,transparent_70%)]" aria-hidden />
          <div className="relative flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--ink)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-strong)] text-[13px]">✦</span>
            CapAI
          </div>

          <div className="relative flex flex-col items-center gap-4">
            <h2 id="export-progress-title" className="font-display text-[20px] font-[300] tracking-tight text-[var(--ink)]" style={{ fontFamily: "var(--font-eb), 'EB Garamond', serif" }}>
              Exporting...
            </h2>
            <div className="flex items-center justify-center" aria-hidden>
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--primary)]/15 border-t-[var(--primary)]" />
            </div>

            {/* Progress bar — ink */}
            <div className="mt-1 flex w-[280px] flex-col items-center gap-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)]">
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(4, progress)}%` }}
                />
              </div>
              <p className="font-mono text-xs tabular-nums text-[var(--ink)]">
                {progress > 0 ? `${progress}%` : "Preparing..."}
              </p>
            </div>

            <p className="max-w-[320px] text-sm leading-relaxed text-[var(--muted)]">
              Large videos may take a few minutes.
            </p>
            {fileSizeLabel && (
              <p className="text-xs text-[var(--muted)]">
                {fileSizeLabel} · {resolutionLabel} · {wordCount} words
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleCancel}
            className="relative mt-2 inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            Cancel
          </button>
        </div>

        <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
      </div>
    );
  }

  // Step 3 complete — light card with gradient orbs subtle, button-primary
  if (step === 3) {
    return (
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--canvas)]/70 backdrop-blur-[6px] p-4 animate-[fadeIn_160ms_ease-out]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-done-title"
        onClick={(e) => {
          if (e.target === overlayRef.current) onClose();
        }}
      >
        <div
          className="relative flex w-full max-w-[460px] flex-col items-center gap-6 rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] p-7 shadow-[var(--shadow-elevated)] animate-[scaleIn_180ms_ease-out] text-center overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* subtle orbs */}
          <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.14)_0%,transparent_70%)]" aria-hidden />
          <div className="pointer-events-none absolute -left-10 -bottom-10 h-28 w-28 rounded-full bg-[radial-gradient(circle_at_center,rgba(200,184,224,0.12)_0%,transparent_70%)]" aria-hidden />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(22,163,74,0.08)] border border-[rgba(22,163,74,0.18)] text-[var(--semantic-success)]">
            <span className="text-[20px] leading-none">✓</span>
          </div>
          <div className="space-y-2 relative">
            <h2 id="export-done-title" className="font-display text-[24px] font-[300] tracking-tight text-[var(--ink)]" style={{ fontFamily: "var(--font-eb), 'EB Garamond', serif" }}>
              Done!
            </h2>
            <p className="text-sm text-[var(--muted)]">Your captioned video is ready.</p>
            {fileSizeLabel && resultBlob && (
              <p className="text-xs font-mono text-[var(--muted)]">
                {(resultBlob.size / (1024 * 1024)).toFixed(1)} MB · {filenamePreview}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex w-full h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[var(--shadow-soft)] hover:bg-[var(--primary-active)] active:scale-[0.98] transition"
          >
            <span aria-hidden>↓</span> Download {resultFilename || filenamePreview}
          </button>

          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={handleExportAgain}
              className="inline-flex flex-1 h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
            >
              Export Again
            </button>
            <button
              type="button"
              onClick={handleBackToEditor}
              className="inline-flex flex-1 h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] px-4 text-sm font-[500] text-[var(--ink)] hover:bg-[var(--hairline)]"
            >
              Back to Editor
            </button>
          </div>

          <button
            type="button"
            aria-label="Close export dialog"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-card)] text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
        <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes scaleIn{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      </div>
    );
  }

  // Step 1 — confirmation modal — light card surface-card rounded xl, hairline, gradient orbs subtle
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--canvas)]/72 backdrop-blur-[8px] p-4 animate-[fadeIn_160ms_ease-out]"
      role="presentation"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="relative flex w-full max-w-[520px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-elevated)] animate-[scaleIn_180ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* subtle gradient orbs */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.16)_0%,transparent_70%)]" aria-hidden />
        <div className="pointer-events-none absolute -left-10 -bottom-10 h-24 w-24 rounded-full bg-[radial-gradient(circle_at_center,rgba(244,197,168,0.13)_0%,transparent_70%)]" aria-hidden />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(200,184,224,0.10)_0%,transparent_70%)]" aria-hidden />
        {/* Header */}
        <div className="relative flex items-start justify-between gap-4 border-b border-[var(--hairline-soft)] px-6 pb-4 pt-5 bg-[var(--surface-card)]">
          <div className="min-w-0 flex-1">
            <h2 id="export-title" className="font-display text-[18px] font-[500] tracking-tight text-[var(--ink)]" style={{ fontFamily: "var(--font-eb), 'EB Garamond', serif" }}>
              Export Video
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)] truncate" title={projectName}>
              {projectName || "video.mp4"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close export dialog"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-card)] text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        {/* Body */}
        <div className="relative px-6 py-5 bg-[var(--surface-card)]">
          {/* File info grid — feature-card inner */}
          <div className="rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--canvas-soft)] p-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">FORMAT</p>
                <p className="font-medium leading-tight text-[var(--ink)]">{canvasFormatLabel}</p>
                <p className="text-[10px] leading-snug text-[var(--muted)]">plays in Chrome / VLC / Media Player · no 32 MB WASM</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">QUALITY</p>
                <p className="font-medium leading-snug text-[var(--ink)]">
                  Original resolution, burned-in hard subtitles — wasm-free canvas (guaranteed 1080×1920 Bold 60 at 0:05)
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">DURATION</p>
                <p className="font-mono text-[var(--ink)]">{durationLabel}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">MODE</p>
                <p className="font-[500] text-[var(--ink)]">{modeLabel}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">CAPTIONS</p>
                <p className="text-[var(--ink)]">
                  {segments.length} segments · {wordCount} words
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">RESOLUTION</p>
                <p className="font-mono text-[var(--ink)]">{resolutionLabel}</p>
              </div>
            </div>

            {fileSizeLabel && (
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--hairline-soft)] pt-3 text-xs">
                <span className="text-[var(--muted)]">Original size</span>
                <span className="font-mono font-[500] text-[var(--ink)]">{fileSizeLabel}</span>
                {isLargeFile && (
                  <span className="ml-2 rounded-full border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.14)] px-2 py-0.5 text-[10px] font-medium text-[var(--warning)]">
                    &gt;2 GB — may be slow
                  </span>
                )}
              </div>
            )}

            <div className="mt-3 rounded-[8px] bg-[var(--surface-card)] border border-[var(--hairline-soft)] px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs text-[var(--ink)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--semantic-success)]" aria-hidden />
                Output: <span className="font-mono font-[500] text-[var(--ink)] truncate">{filenamePreview}</span>
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 flex gap-2.5 rounded-[10px] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3.5 py-3 text-sm leading-snug text-[var(--semantic-error)]"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,0.10)] text-[11px]">!</span>
              <span className="flex-1 break-words">{error}</span>
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
            Canvas burn (MediaRecorder + <span className="font-[500] text-[var(--ink)]">captureStream 30 fps</span>) guarantees captions — no 32 MB WASM fetch, works offline on Windows. Exports as <span className="font-[500] text-[var(--ink)]">WebM VP9</span> (VLC/Chrome/Media Player). Audio via video captureStream. Wall time ~1× duration (52 s). Keep tab open. FFmpeg is automatic fallback.
          </p>
        </div>

        {/* Footer — light */}
        <div className="relative flex items-center justify-between gap-3 border-t border-[var(--hairline-soft)] bg-[var(--surface-strong)]/40 px-6 py-4 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-card)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStartExport}
            disabled={!videoBlob || segments.length === 0}
            aria-label="Start Export"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[var(--shadow-soft)] hover:bg-[var(--primary-active)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Export <span aria-hidden>→</span>
          </button>
        </div>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes scaleIn{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
    </div>
  );
}
