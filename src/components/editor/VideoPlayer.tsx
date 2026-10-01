"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/context/EditorContext";
import CanvasOverlay from "./CanvasOverlay";
import { formatDuration } from "@/lib/utils";
import { getVideoMetadata } from "@/lib/export";

type PlaybackRate = 0.5 | 1 | 1.5 | 2;

const SPEEDS: PlaybackRate[] = [0.5, 1, 1.5, 2];

/**
 * VideoPlayer panel — raw video + canvas overlay + chrome
 * PRD §4.5.1
 * Fixed: dynamic aspect-ratio based on actual video dimensions (9:16 → portrait, no letterboxing)
 */
interface VideoPlayerProps {
  videoDims?: { w: number; h: number } | null;
}

export default function VideoPlayer({ videoDims: externalDims }: VideoPlayerProps = {}) {
  const ctx = useEditor();
  const {
    project,
    currentTimeMs,
    durationMs,
    isPlaying,
    togglePlay,
    seekTo,
    volume,
    isMuted,
    setVolume,
    setMuted,
    playbackRate,
    setPlaybackRate,
    registerVideo,
  } = ctx;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefInternal = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [seekDragging, setSeekDragging] = useState(false);
  const [localSeekMs, setLocalSeekMs] = useState<number | null>(null);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [measuredDims, setMeasuredDims] = useState<{ w: number; h: number } | null>(null);

  // Resolved video dimensions: prefer external (EditorShell's videoDims) when available, else internal measurement
  const hasExternal = !!(externalDims && externalDims.w && externalDims.h && externalDims.w >= 64 && externalDims.h >= 64);
  const dims = hasExternal ? (externalDims as { w: number; h: number }) : measuredDims;
  const isPortrait = !!(dims && dims.h > dims.w);
  // Scroll-fix stage — Video card is now shrink-0 flex-none (h-auto), not flex-1, so stage must not use height:0+flex:1 trick which left white gap when card stretched.
  // Use natural aspectRatio + width:100% + height:auto with a viewport-capped maxHeight so portrait 9:16 never exceeds available desktop height.
  // At lg (desktop fixed viewport lg:h-[calc(100vh-64px)] with secondary header 48px + p-4 + controls ~120px), max ~62vh keeps 9:16 at ~540-560px @900px, leaving Caption+Waveform ~190px < 788 without scroll. Mobile uses same cap but natural page scroll allowed (no outer overflow-hidden).
  const stageStyle: React.CSSProperties | undefined =
    dims && !isFullscreen
      ? {
          aspectRatio: `${dims.w} / ${dims.h}`,
          width: "100%",
          height: "auto",
          maxWidth: "100%",
          maxHeight: "min(62vh, 640px)",
          alignSelf: "center",
        }
      : undefined;

  // Blob URL — stable for mount lifetime, only revoked when blob identity changes or unmount.
  // Fixes race where useMemo + revoke-on-videoUrl-change could revoke before 60 MB video fires
  // loadedmetadata/seeked (100-300 ms), causing MEDIA_ERR_SRC_NOT_SUPPORTED + blob 404.
  // Derive blob identity directly so effect only re-runs when the underlying Blob object changes,
  // not on every parent re-render / currentTime tick (project object is recreated on segments edits).
  const videoBlob = project?.videoBlob as Blob | undefined;
  const videoUrlRef = useRef<string | null>(null);
  const prevBlobRef = useRef<Blob | undefined>(undefined);
  const [videoUrl, setVideoUrl] = useState<string | null>(() => {
    if (!videoBlob) return null;
    try {
      const url = URL.createObjectURL(videoBlob);
      videoUrlRef.current = url;
      prevBlobRef.current = videoBlob;
      return url;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    // If blob identity hasn't changed since last creation (including lazy init), skip
    if (videoBlob === prevBlobRef.current) return;

    // Revoke previous URL synchronously before creating new one
    if (videoUrlRef.current) {
      try {
        URL.revokeObjectURL(videoUrlRef.current);
      } catch {}
      videoUrlRef.current = null;
    }

    if (!videoBlob) {
      prevBlobRef.current = undefined;
      setVideoUrl(null);
      return;
    }

    let url: string;
    try {
      url = URL.createObjectURL(videoBlob);
    } catch {
      prevBlobRef.current = undefined;
      setVideoUrl(null);
      return;
    }
    videoUrlRef.current = url;
    prevBlobRef.current = videoBlob;
    setVideoUrl(url);

    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      if (videoUrlRef.current === url) videoUrlRef.current = null;
    };
  }, [videoBlob]);

  // Also handle unmount when lazy init created URL but effect never re-ran (no cleanup registered)
  useEffect(() => {
    return () => {
      if (videoUrlRef.current) {
        try {
          URL.revokeObjectURL(videoUrlRef.current);
        } catch {}
        videoUrlRef.current = null;
      }
    };
  }, []);

  // Ensure video element picks up the new URL and explicitly starts loading.
  // Large MP4s (60 MB, 1080×1920) need an explicit load() so readyState proceeds to 4
  // before any subsequent render — avoids black player / duration 0:00.
  // JSX already sets src={videoUrl}, but we call load() explicitly when readyState is 0
  // and also handle the case where video element mounts after URL is already set.
  useEffect(() => {
    const v = videoRefInternal.current;
    if (!v) return;
    if (!videoUrl) {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {}
      return;
    }
    if (v.src !== videoUrl) {
      try {
        v.src = videoUrl;
      } catch {}
    }
    // Trigger load if video hasn't started loading yet (readyState 0 / networkState 0/3)
    // This is the crucial fix validated manually: fresh createObjectURL + video.src=fresh + video.load()
    if (v.readyState === 0) {
      try {
        v.load();
      } catch {}
    }
  }, [videoUrl]);

  // Bridge internal ref to context
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRefInternal.current = el;
      registerVideo(el);
      // If video element mounts after URL already exists (initial mount with large file),
      // ensure src is set and load() is called immediately — avoids waiting for next effect tick
      if (el && videoUrlRef.current) {
        try {
          if (el.src !== videoUrlRef.current) el.src = videoUrlRef.current;
          if (el.readyState === 0) el.load();
        } catch {}
      }
    },
    [registerVideo]
  );

  // ── Dynamic aspect dims capture (self-sufficient fallback when externalDims missing)
  useEffect(() => {
    if (hasExternal) return;
    const immediate = videoRefInternal.current;
    if (immediate && immediate.videoWidth && immediate.videoHeight) {
      setMeasuredDims({ w: immediate.videoWidth, h: immediate.videoHeight });
    }
    let cancelled = false;
    const onMeta = () => {
      const el = videoRefInternal.current;
      if (el && el.videoWidth && el.videoHeight && !cancelled) {
        setMeasuredDims({ w: el.videoWidth, h: el.videoHeight });
      }
    };
    const el = videoRefInternal.current;
    if (el) {
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("loadeddata", onMeta);
      if (el.readyState >= 1 && el.videoWidth && el.videoHeight) onMeta();
    }
    // Blob metadata fallback — reliable ground truth for vertical 1080x1920 even before video mounts
    const blob = project?.videoBlob as Blob | undefined;
    if (blob && blob.size > 0) {
      getVideoMetadata(blob)
        .then((meta) => {
          if (cancelled || hasExternal) return;
          if (meta.width && meta.height && meta.width >= 64 && meta.height >= 64) {
            setMeasuredDims((prev) => {
              if (!prev || prev.w !== meta.width || prev.h !== meta.height) return { w: meta.width, h: meta.height };
              return prev;
            });
          }
        })
        .catch((e) => {
          // BUG-UI-1 fix: don't swallow silently — dims fallback stays 16:9 if this fails, so surface the error
          console.warn("[VideoPlayer] getVideoMetadata failed", e);
        });
    }
    // Late-mount polling (video element may mount after effect)
    let timeoutId: number | null = null;
    let attempts = 0;
    const tick = () => {
      if (cancelled || hasExternal) return;
      const ev = videoRefInternal.current;
      if (ev && ev.videoWidth && ev.videoHeight) {
        setMeasuredDims({ w: ev.videoWidth, h: ev.videoHeight });
        return;
      }
      attempts += 1;
      if (attempts < 20) timeoutId = window.setTimeout(tick, 150) as unknown as number;
    };
    if (!hasExternal) timeoutId = window.setTimeout(tick, 200) as unknown as number;
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (el) {
        el.removeEventListener("loadedmetadata", onMeta);
        el.removeEventListener("loadeddata", onMeta);
      }
    };
  }, [hasExternal, videoUrl, project?.id, project?.videoBlob]);

  // Fullscreen handling (expands player only)
  const handleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Seek bar interactions
  const seekBarRef = useRef<HTMLDivElement | null>(null);

  const getSeekMsFromClientX = useCallback(
    (clientX: number) => {
      const bar = seekBarRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const total = durationMs || 0;
      return ratio * total;
    },
    [durationMs]
  );

  const handleSeekPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {}
      const ms = getSeekMsFromClientX(e.clientX);
      setSeekDragging(true);
      setLocalSeekMs(ms);
      seekTo(ms);
    },
    [getSeekMsFromClientX, seekTo]
  );

  const handleSeekPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ms = getSeekMsFromClientX(e.clientX);
      setHoverTimeMs(ms);
      setHoverX(e.clientX);
      if (seekDragging) {
        setLocalSeekMs(ms);
        seekTo(ms);
      }
    },
    [getSeekMsFromClientX, seekDragging, seekTo]
  );

  const handleSeekPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ms = getSeekMsFromClientX(e.clientX);
      setSeekDragging(false);
      setLocalSeekMs(null);
      seekTo(ms);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    },
    [getSeekMsFromClientX, seekTo]
  );

  const handleSeekHoverMove = useCallback(
    (e: React.MouseEvent) => {
      if (seekDragging) return;
      const ms = getSeekMsFromClientX(e.clientX);
      setHoverTimeMs(ms);
      // store relative X for tooltip placement
      const bar = seekBarRef.current;
      if (bar) {
        const rect = bar.getBoundingClientRect();
        setHoverX(e.clientX - rect.left);
      }
    },
    [getSeekMsFromClientX, seekDragging]
  );

  const handleSeekLeave = useCallback(() => {
    if (!seekDragging) {
      setHoverTimeMs(null);
      setHoverX(null);
    }
  }, [seekDragging]);

  const displayTimeMs = seekDragging && localSeekMs !== null ? localSeekMs : currentTimeMs;
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, displayTimeMs / durationMs)) : 0;

  // Volume bar
  const volumeBarRef = useRef<HTMLDivElement | null>(null);
  const getVolumeFromClientX = useCallback((clientX: number) => {
    const bar = volumeBarRef.current;
    if (!bar) return volume;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio;
  }, [volume]);

  const handleVolumePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setVolumeDragging(true);
      const v = getVolumeFromClientX(e.clientX);
      setVolume(v);
      if (v > 0 && isMuted) setMuted(false);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    },
    [getVolumeFromClientX, setVolume, isMuted, setMuted]
  );

  const handleVolumePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!volumeDragging) return;
      const v = getVolumeFromClientX(e.clientX);
      setVolume(v);
      if (v > 0 && isMuted) setMuted(false);
    },
    [volumeDragging, getVolumeFromClientX, setVolume, isMuted, setMuted]
  );

  const handleVolumePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setVolumeDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    },
    []
  );

  const toggleMute = useCallback(() => setMuted(!isMuted), [isMuted, setMuted]);

  // Keyboard volume? not needed

  if (!project) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] text-sm text-[var(--muted)]">
        No project
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`group flex flex-col shrink-0 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-card)] w-full ${isPortrait && !isFullscreen ? "mx-auto" : ""} ${isFullscreen ? "rounded-none border-0 !bg-[var(--surface-dark)]" : ""}`}
    >
      {/* Video stage — shrink-0 h-auto so Video card sizes to content; stage uses aspectRatio+maxHeight cap, not flex-1 height:0 which caused white gap. Fullscreen restores flex-1. */}
      <div
        className={`relative overflow-hidden bg-[var(--surface-dark)] w-full ${isFullscreen ? "flex flex-1 min-h-0 items-center justify-center" : dims ? "flex shrink-0 items-center justify-center" : "aspect-video shrink-0"}`}
        style={stageStyle}
      >
        {videoBlob ? (
          videoUrl ? (
            <>
              <video
                ref={setVideoRef}
                src={videoUrl}
                className="h-full w-full object-contain"
                playsInline
                preload="metadata"
                onClick={togglePlay}
                // Keep native controls hidden; we provide custom
                controls={false}
              />
              {/* Canvas overlay */}
              <CanvasOverlay videoRef={videoRefInternal} />
              {/* Click-to-play big button when paused (center) — ink pill on dark stage for contrast */}
              {!isPlaying && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label="Play"
                  className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-[var(--surface-dark)]/70 text-white backdrop-blur-md transition hover:bg-[var(--surface-dark)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  style={{ pointerEvents: "auto" }}
                >
                  <span aria-hidden className="ml-0.5 text-[20px] leading-none">▶</span>
                </button>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--surface-dark)] p-6 text-center text-sm text-white/70">
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
                Loading video…
              </span>
            </div>
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--canvas-soft)] p-6 text-center text-sm text-[var(--muted)]">
            No video blob available
          </div>
        )}

        {/* Top subtle gradient for readability if needed — on dark stage only */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/20 to-transparent opacity-60" aria-hidden />
      </div>

      {/* Chrome — bottom control bar — shrink-0 so flex stage never compresses controls — decluttered: gap-4 rows, breathing room */}
      <div className="flex shrink-0 flex-col gap-4 border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] p-3 sm:p-4">
        {/* Row 1: seek bar + time — full width, gap-3 */}
        <div className="flex items-center gap-3 px-1">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_2px_10px_rgba(12,10,9,0.08)] transition hover:bg-[var(--primary-active)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <span className="text-[12px] leading-none" aria-hidden>
              {isPlaying ? "❚❚" : "▶"}
            </span>
          </button>

          {/* Seek bar — light hairline track, ink fill */}
          <div
            ref={seekBarRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={durationMs || 0}
            aria-valuenow={Math.round(displayTimeMs)}
            tabIndex={0}
            onPointerDown={handleSeekPointerDown}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={handleSeekPointerUp}
            onMouseMove={handleSeekHoverMove}
            onMouseLeave={handleSeekLeave}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                seekTo(currentTimeMs - 5000);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                seekTo(currentTimeMs + 5000);
              } else if (e.key === "Home") {
                e.preventDefault();
                seekTo(0);
              } else if (e.key === "End") {
                e.preventDefault();
                seekTo(durationMs);
              }
            }}
            className="relative flex-1 cursor-pointer touch-none select-none py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] rounded-full"
          >
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)]">
              {/* played — ink */}
              <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)]" style={{ width: `${progress * 100}%`, boxShadow: "0 0 8px rgba(12,10,9,0.10)" }} />
              {/* handle — ink pill with white border */}
              <div
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--primary)] shadow-[0_1px_6px_rgba(0,0,0,0.24)]"
                style={{ left: `${progress * 100}%`, opacity: durationMs > 0 ? 1 : 0 }}
              />
            </div>
            {/* Hover timestamp bubble — light card */}
            {hoverTimeMs !== null && hoverX !== null && !seekDragging && (
              <div
                className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-[var(--surface-card)] px-2 py-0.5 text-[11px] font-mono text-[var(--ink)] shadow-[var(--shadow-soft)]"
                style={{ left: hoverX }}
              >
                {formatDuration(hoverTimeMs)}
              </div>
            )}
          </div>

          <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--ink)]">
            {formatDuration(displayTimeMs)} / {formatDuration(durationMs || 0)}
          </span>
        </div>

        {/* Row 2: left SPEED + pills | middle volume | right fullscreen — decluttered grouping */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 px-1">
            <span className="hidden text-[11px] font-medium uppercase tracking-[0.96px] text-[var(--muted)] sm:inline">SPEED</span>
            <span className="flex items-center gap-1.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPlaybackRate(s)}
                  aria-label={`Set playback speed to ${s}×`}
                  className={`inline-flex h-7 min-w-[42px] items-center justify-center rounded-full border px-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
                    playbackRate === s
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white shadow-[var(--shadow-soft)]"
                      : "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                  }`}
                  aria-pressed={playbackRate === s}
                >
                  {s}×
                </button>
              ))}
            </span>
          </div>

          <div className="flex items-center gap-2 px-1">
            {/* Volume — w-24 slider with gap-2 to mute icon, h-1 track, decluttered */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                title={isMuted ? "Muted" : `Volume ${Math.round(volume * 100)}%`}
              >
                <span className="text-[14px] leading-none" aria-hidden>
                  {isMuted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
                </span>
              </button>

              <div
                ref={volumeBarRef}
                role="slider"
                aria-label="Volume"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
                tabIndex={0}
                onPointerDown={handleVolumePointerDown}
                onPointerMove={handleVolumePointerMove}
                onPointerUp={handleVolumePointerUp}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setVolume(Math.max(0, volume - 0.05));
                  } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setVolume(Math.min(1, volume + 0.05));
                  } else if (e.key === "m" || e.key === "M") {
                    e.preventDefault();
                    toggleMute();
                  }
                }}
                className="relative flex h-1 w-24 cursor-pointer touch-none items-center rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)]" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--primary)] shadow"
                  style={{ left: `${(isMuted ? 0 : volume) * 100}%` }}
                />
              </div>
            </div>

            <div className="h-5 w-px bg-[var(--hairline-soft)]" aria-hidden />

            <button
              type="button"
              onClick={handleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 text-xs font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            >
              <span className="text-[13px] leading-none" aria-hidden>
                {isFullscreen ? "⤓" : "⛶"}
              </span>
              <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
            </button>
          </div>
        </div>

        {/* Frame step hint — decluttered: muted, tracking-wide, kbd pills, opacity-60 with mt-1 separation */}
        <p className="hidden sm:flex justify-center gap-4 text-center text-[11px] tracking-wide text-[var(--muted)] opacity-60 mt-1">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-[var(--hairline)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[11px] leading-none">Space</kbd>
            <span>play/pause</span>
          </span>
          <span aria-hidden className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-[var(--hairline)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[11px] leading-none">←</kbd>
            <span className="mx-0.5">/</span>
            <kbd className="rounded border border-[var(--hairline)] bg-[var(--surface-strong)] px-1 py-0.5 font-mono text-[11px] leading-none">→</kbd>
            <span className="ml-1">frame step (±33ms)</span>
          </span>
        </p>
      </div>
    </div>
  );
}
