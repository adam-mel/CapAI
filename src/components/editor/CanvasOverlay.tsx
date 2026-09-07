"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/context/EditorContext";
import { getActiveSegment, renderCaption } from "@/lib/canvasRenderer";

interface CanvasOverlayProps {
  /** Optional explicit video element ref for sizing; defaults to context videoRef */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  className?: string;
}

/**
 * CanvasOverlay — absolutely positioned canvas matching video dimensions.
 * Draws captions on every timeupdate + requestAnimationFrame for smoothness.
 * Pointer events disabled so clicking doesn't trigger edit (per PRD).
 */
export default function CanvasOverlay({ videoRef: externalVideoRef, className }: CanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctx = useEditor();
  const { segments, captionStyle, settings, currentTimeMs, videoRef: ctxVideoRef } = ctx;

  const videoRef = externalVideoRef ?? ctxVideoRef;

  // Resize observer: match canvas backing store to video's *content* rect (object-contain), not container box.
  // For 9:16 video in 16:9 stage, container includes black bars → preview must map to content rect
  // so captions coords match export PlayRes 1080x1920 (PRD §5.2). DPR-aware backing store.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const syncSize = () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const videoEl = videoRef.current;
      const c = canvasRef.current;
      if (!videoEl || !c) return;
      const container = videoEl.parentElement;
      if (!container) return;
      const containerW = container.clientWidth;
      const containerH = container.clientHeight;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;

      let contentW: number;
      let contentH: number;
      let offsetX: number;
      let offsetY: number;

      if (vw && vh && containerW > 0 && containerH > 0) {
        const videoAspect = vw / vh;
        const containerAspect = containerW / containerH;
        if (videoAspect > containerAspect) {
          contentW = containerW;
          contentH = containerW / videoAspect;
          offsetX = 0;
          offsetY = (containerH - contentH) / 2;
        } else {
          contentH = containerH;
          contentW = containerH * videoAspect;
          offsetX = (containerW - contentW) / 2;
          offsetY = 0;
        }
      } else {
        // Fallback while metadata pending: use container as content (aspect-video placeholder)
        // Will be corrected on next sync once videoWidth available (<1s via getVideoMetadata/loadedmetadata)
        const rect = videoEl.getBoundingClientRect();
        contentW = Math.max(1, rect.width || containerW || 320);
        contentH = Math.max(1, rect.height || containerH || 180);
        offsetX = 0;
        offsetY = 0;
      }

      // Position canvas exactly over video content rect (not black bars)
      // Override Tailwind inset-0 (which sets right:0/bottom:0) so width/height are respected
      c.style.left = offsetX + "px";
      c.style.top = offsetY + "px";
      c.style.right = "auto";
      c.style.bottom = "auto";
      c.style.width = contentW + "px";
      c.style.height = contentH + "px";
      // Backing store in device pixels for crisp text
      const w = Math.max(1, Math.round(contentW * dpr));
      const h = Math.max(1, Math.round(contentH * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    };

    syncSize();

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => syncSize());
      ro.observe(video);
      const stage = video.parentElement;
      if (stage) ro.observe(stage);
      if (containerRef.current) ro.observe(containerRef.current);
      const parent = canvas.parentElement;
      if (parent) ro.observe(parent);
    } catch {
      window.addEventListener("resize", syncSize);
    }

    video.addEventListener("loadedmetadata", syncSize);
    video.addEventListener("loadeddata", syncSize);
    document.addEventListener("fullscreenchange", syncSize);

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", syncSize);
      video.removeEventListener("loadedmetadata", syncSize);
      video.removeEventListener("loadeddata", syncSize);
      document.removeEventListener("fullscreenchange", syncSize);
    };
  }, [videoRef]);

  // UI-19: keep latest values in refs so rAF loop doesn't teardown each keystroke
  const currentTimeRef = useRef(currentTimeMs);
  const segmentsRef = useRef(segments);
  const captionStyleRef = useRef(captionStyle);
  const modeRef = useRef(settings.mode);
  useEffect(() => { currentTimeRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { captionStyleRef.current = captionStyle; }, [captionStyle]);
  useEffect(() => { modeRef.current = settings.mode; }, [settings.mode]);

  // Render loop: draw on every timeupdate + rAF while playing
  // Setup only — does NOT depend on currentTimeMs/segments (see refs above) — UI-19 stutter fix
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    if (!c) return;

    let raf: number | null = null;
    // Track last segment for future fade handling (200ms fade spec)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for fade tracking
    let lastSegmentId: string | null = null;
    const fadeOpacity = 1;

    const draw = () => {
      const video = videoRef.current;
      // Prefer video element time for smoothness during rAF; fallback to ref (no dep churn)
      const t = video ? video.currentTime * 1000 : currentTimeRef.current;
      const active = getActiveSegment(segmentsRef.current, t);
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      // Canvas backing store is dpr-scaled; drawing uses logical CSS pixels so preview matches export PlayRes aspect
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      // Reset transform to dpr scale (logical -> device). Renderer expects logical canvasWidth/Height.
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      const mode = modeRef.current;

      // Call renderer — w/h are logical contentW/H (matches export video frame, not container black bars)
      renderCaption(c, active, captionStyleRef.current, t, mode, w, h);

      // Store for fade detection (could add opacity interpolation here)
      lastSegmentId = active?.id ?? null;
      void fadeOpacity;
    };

    // Immediate draw
    draw();

    // rAF loop when playing
    const video = videoRef.current;
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf === null) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      // One final draw to ensure correct state when paused
      draw();
    };

    // Listen to video events to start/stop rAF
    if (video) {
      video.addEventListener("play", start);
      video.addEventListener("pause", stop);
      video.addEventListener("seeked", draw);
      video.addEventListener("timeupdate", draw);
      if (!video.paused) start();
    } else {
      // Fallback: drive via rAF when no video element (e.g., tests)
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (video) {
        video.removeEventListener("play", start);
        video.removeEventListener("pause", stop);
        video.removeEventListener("seeked", draw);
        video.removeEventListener("timeupdate", draw);
      }
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // UI-19: deps stable — values read via refs so loop isn't recreated each keystroke
  }, [videoRef]);

  // Also redraw when captionStyle changes outside video tick (e.g., paused)
  // The above effect handles it via deps; but to be extra responsive we draw once more when style changes even if paused
  // That's already covered by the effect's draw() immediate call.

  // UI-20: off-screen live region for AT — captions invisible to canvas
  const activeForA11y = getActiveSegment(segments, currentTimeMs);
  return (
    <>
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      >
        <canvas
          ref={canvasRef}
          className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
          role="img"
          aria-label={activeForA11y ? `Caption: ${activeForA11y.text}` : "Caption canvas"}
          style={{ pointerEvents: "none", display: "block" }}
        />
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {activeForA11y?.text ?? ""}
      </div>
    </>
  );
}
