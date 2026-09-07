"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/context/EditorContext";
import { extractWaveformData } from "@/lib/waveform";
import { formatDuration } from "@/lib/utils";
import type { CaptionSegment } from "@/lib/types";

/**
 * Waveform — Bottom collapsible strip per PRD §4.5.4
 * Height ~80px when expanded:
 *  - top: audio waveform bars (canvas)
 *  - bottom: caption segments as colored blocks with edge handles
 *  - playhead draggable
 */
export default function Waveform() {
  const {
    project,
    segments,
    durationMs,
    currentTimeMs,
    seekTo,
    setSegments,
    pushHistory,
    activeSegmentId,
  } = useEditor();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [draggingHandle, setDraggingHandle] = useState<{
    id: string;
    edge: "start" | "end";
  } | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [liveSegments, setLiveSegments] = useState<CaptionSegment[] | null>(null);

  // Effective segments during drag (live preview) else real segments
  const displaySegments = liveSegments ?? segments;
  const segmentsRef = useRef(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  // --- Measure container width for timeline sizing ---
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // --- Timeline width: scrollable if long video ---
  const pxPerSec = durationMs > 0 && durationMs / 1000 > 180 ? 12 : 22; // adapt for very long
  const minTimelineWidth = durationMs > 0 ? (durationMs / 1000) * pxPerSec : containerWidth;
  const timelineWidth = Math.max(containerWidth || 600, Math.min(minTimelineWidth, 6000));

  // --- Extract waveform data from videoBlob ---
  useEffect(() => {
    const blob = project?.videoBlob as Blob | undefined;
    if (!blob) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync waveform clear when blob missing
      setWaveform([]);
      return;
    }
    let cancelled = false;
    setWaveformLoading(true);
    extractWaveformData(blob, 800)
      .then((data) => {
        if (!cancelled) setWaveform(data);
      })
      .catch(() => {
        if (!cancelled) setWaveform([]);
      })
      .finally(() => {
        if (!cancelled) setWaveformLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.videoBlob]);

  // --- Render waveform to canvas — light editorial with ink / muted bars ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || timelineWidth <= 0) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = Math.max(1, Math.round(timelineWidth * dpr));
    const h = Math.round(48 * dpr);
    // Only resize if needed to avoid clearing repeatedly
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = `${timelineWidth}px`;
    canvas.style.height = `48px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (waveform.length === 0) {
      // faint baseline — hairline-strong
      ctx.fillStyle = "rgba(214,211,209,0.55)";
      ctx.fillRect(0, h / 2 - 1 * dpr, w, 2 * dpr);
      if (waveformLoading) {
        ctx.fillStyle = "rgba(119,113,105,0.60)";
        ctx.font = `${10 * dpr}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText("Analyzing audio…", w / 2, h / 2 + 4 * dpr);
      }
      return;
    }

    const barCount = waveform.length;
    const slotW = w / barCount;
    const barW = Math.max(1 * dpr, slotW * 0.62);
    const gap = slotW - barW;
    const centerY = h / 2;

    for (let i = 0; i < barCount; i++) {
      const amp = waveform[i];
      const bh = Math.max(2 * dpr, amp * h * 0.86);
      const y = centerY - bh / 2;
      const x = i * slotW + gap / 2;

      // color: ink primary for peaks, muted for rest — editorial light
      const isPeak = amp > 0.82;
      ctx.fillStyle = isPeak ? "rgba(41,37,36,0.88)" : "rgba(119,113,105,0.42)";
      // Rounded bars
      const r = Math.min(2 * dpr, barW / 2);
      ctx.beginPath();
      if (
        typeof (ctx as unknown as { roundRect?: (...args: unknown[]) => unknown }).roundRect === "function"
      ) {
        try {
          (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(
            x,
            y,
            barW,
            bh,
            r
          );
          ctx.fill();
          continue;
        } catch {}
      }
      // Fallback rect
      ctx.fillRect(x, y, barW, bh);
    }
  }, [waveform, waveformLoading, timelineWidth]);

  // --- Helpers: time <-> pixel ---
  const timeToPx = useCallback(
    (ms: number) => {
      if (!durationMs) return 0;
      return (ms / durationMs) * timelineWidth;
    },
    [durationMs, timelineWidth]
  );

  const pxToTime = useCallback(
    (px: number) => {
      if (!timelineWidth || !durationMs) return 0;
      const ratio = px / timelineWidth;
      return Math.max(0, Math.min(durationMs, ratio * durationMs));
    },
    [durationMs, timelineWidth]
  );

  const playheadPx = useMemo(() => timeToPx(currentTimeMs), [timeToPx, currentTimeMs]);

  // --- Timeline click to seek (excluding handle drags) ---
  const handleTimelinePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore if clicking on handle or segment interior with drag intent
      const target = e.target as HTMLElement;
      if (target.closest("[data-handle]")) return;
      // If dragging segment handle, ignore
      if (draggingHandle) return;

      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const ms = pxToTime(x);
      seekTo(ms);
      setDraggingPlayhead(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    },
    [draggingHandle, pxToTime, seekTo]
  );

  const handleTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingPlayhead) return;
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const ms = pxToTime(x);
      seekTo(ms);
    },
    [draggingPlayhead, pxToTime, seekTo]
  );

  const handleTimelinePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingPlayhead) {
        const rect = timelineRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left;
          const ms = pxToTime(x);
          seekTo(ms);
        }
      }
      setDraggingPlayhead(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    },
    [draggingPlayhead, pxToTime, seekTo]
  );

  // --- Segment edge drag — UI-32 stale closure fix: use ref for segments ---
  const handleEdgePointerDown = useCallback(
    (e: React.PointerEvent, segId: string, edge: "start" | "end") => {
      e.preventDefault();
      e.stopPropagation();
      // Push history once at drag start
      pushHistory();
      setDraggingHandle({ id: segId, edge });
      // Keep live copy for smooth preview — use ref to avoid stale closure (UI-32)
      const current = segmentsRef.current;
      setLiveSegments(current.map((s) => ({ ...s, words: s.words.map((w) => ({ ...w })) })));
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    },
    [pushHistory]
  );

  // Global window listeners for handle drag
  useEffect(() => {
    if (!draggingHandle) return;

    const handleMove = (e: PointerEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const msRaw = pxToTime(x);
      const ms = Math.round(msRaw);

      setLiveSegments((prevLive) => {
        const base = prevLive ?? displaySegments;
        const idx = base.findIndex((s) => s.id === draggingHandle.id);
        if (idx === -1) return base;
        const seg = base[idx];
        const prevSeg = idx > 0 ? base[idx - 1] : null;
        const nextSeg = idx < base.length - 1 ? base[idx + 1] : null;

        let newStart = seg.startMs;
        let newEnd = seg.endMs;

        if (draggingHandle.edge === "start") {
          // Clamp: 0 .. end-200, also after prev end + 0
          const minStart = 0;
          const maxStart = seg.endMs - 200;
          let clamped = Math.max(minStart, Math.min(maxStart, ms));
          if (prevSeg && clamped < prevSeg.endMs) clamped = prevSeg.endMs;
          // Also not before 0
          newStart = clamped;
        } else {
          const minEnd = seg.startMs + 200;
          const maxEnd = durationMs || seg.endMs + 10000;
          let clamped = Math.max(minEnd, Math.min(maxEnd, ms));
          if (nextSeg && clamped > nextSeg.startMs) clamped = nextSeg.startMs;
          newEnd = clamped;
        }

        if (newStart === seg.startMs && newEnd === seg.endMs) return base;

        // Update live preview
        const next = base.map((s) => (s.id === draggingHandle.id ? { ...s, startMs: newStart, endMs: newEnd } : s));
        // Keep sorted? Sorting during drag may cause index jump; avoid sort until drag end for preview
        return next;
      });
    };

    const handleUp = () => {
      // Commit live segments to real state
      setLiveSegments((live) => {
        if (live) {
          // Final clamp and sort before commit
          const sorted = [...live].sort((a, b) => a.startMs - b.startMs);
          // Use functional update to commit
          setSegments(sorted);
        }
        return null;
      });
      setDraggingHandle(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [draggingHandle, pxToTime, displaySegments, durationMs, setSegments]);

  // Sync liveSegments with external segments when not dragging (keep in sync if external changes)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear live preview when drag ends
    if (!draggingHandle) setLiveSegments(null);
  }, [segments, draggingHandle]);

  // --- Sorted segments for rendering (stable) ---
  const sorted = useMemo(() => [...displaySegments].sort((a, b) => a.startMs - b.startMs), [displaySegments]);

  // Format for ARIA
  const progressPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;

  return (
    <div className="flex flex-col bg-[var(--surface-card)] select-none rounded-[var(--radius-xl)] overflow-hidden border border-[var(--hairline)] shadow-[var(--shadow-soft)]">
      {/* Header row for mobile hint hidden, main timeline below */}
      <div
        ref={containerRef}
        className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-thin bg-[var(--surface-card)]"
        style={{ scrollbarWidth: "thin" }}
        aria-label="Waveform timeline"
      >
        <div
          ref={timelineRef}
          className="relative h-[80px] bg-[var(--canvas-soft)]"
          style={{ width: timelineWidth, minWidth: "100%" }}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          role="group"
          aria-label="Waveform timeline — click to seek, drag handles to trim"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              seekTo(Math.max(0, currentTimeMs - 1000));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              seekTo(Math.min(durationMs, currentTimeMs + 1000));
            } else if (e.key === "Home") {
              e.preventDefault();
              seekTo(0);
            } else if (e.key === "End") {
              e.preventDefault();
              seekTo(durationMs);
            }
          }}
        >
          {/* Waveform canvas — exposed for a11y, describes audio waveform */}
          <canvas
            ref={canvasRef}
            className="absolute left-0 top-0 block"
            style={{ width: timelineWidth, height: 48 }}
            role="img"
            aria-label="Waveform visualization"
          />

          {/* subtle grid lines every ~10s — hairline-soft */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[48px] overflow-hidden" aria-hidden>
            {durationMs > 0 &&
              Array.from({ length: Math.min(24, Math.floor(durationMs / 10000) + 1) }).map((_, i) => {
                const t = i * 10000;
                if (t > durationMs) return null;
                const left = timeToPx(t);
                return (
                  <span
                    key={i}
                    className="absolute top-0 bottom-0 w-px bg-[var(--hairline-soft)] opacity-60"
                    style={{ left }}
                  />
                );
              })}
          </div>

          {/* Segment blocks strip — light editorial: inactive surface-strong, active ink */}
          <div className="absolute inset-x-0 bottom-[10px] h-[22px] px-0">
            <div className="relative h-full w-full">
              {sorted.map((seg) => {
                const left = timeToPx(seg.startMs);
                const right = timeToPx(seg.endMs);
                const w = Math.max(8, right - left); // min visible
                const isActive = seg.id === activeSegmentId;
                const isDragging = draggingHandle?.id === seg.id;
                return (
                  <div
                    key={seg.id}
                    className={`group absolute top-0 h-full rounded-[6px] border transition-[background,border,box-shadow] ${
                      isActive
                        ? "bg-[var(--primary)] border-[var(--primary)] shadow-[var(--shadow-soft)] z-10"
                        : isDragging
                          ? "bg-[var(--primary)]/70 border-[var(--primary)]/60 z-10"
                          : "bg-[var(--surface-strong)] border-[var(--hairline-strong)] hover:bg-[var(--hairline)] hover:border-[var(--primary)]/40"
                    }`}
                    style={{ left, width: w }}
                    title={`${seg.text || "(empty)"}  ${formatDuration(seg.startMs)} → ${formatDuration(seg.endMs)}`}
                    onPointerDown={(e) => {
                      // Clicking block seeks to its start (if not dragging handle)
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-handle]")) return;
                      e.stopPropagation();
                      seekTo(seg.startMs);
                    }}
                    role="button"
                    aria-label={`Segment ${formatDuration(seg.startMs)} to ${formatDuration(seg.endMs)}: ${seg.text.slice(0, 40)}`}
                  >
                    {/* interior label maybe truncated */}
                    <span className="pointer-events-none absolute inset-0 flex items-center px-1.5 overflow-hidden">
                      <span className={`truncate text-[10px] font-medium leading-none ${isActive ? "text-white" : "text-[var(--ink)]"}`}>{seg.text ? seg.text.slice(0, 18) : "·"}</span>
                    </span>

                    {/* Left handle — light editorial */}
                    <span
                      data-handle="left"
                      onPointerDown={(e) => handleEdgePointerDown(e, seg.id, "start")}
                      className={`absolute left-0 top-0 bottom-0 flex w-[10px] cursor-col-resize items-center justify-center rounded-l-[6px] transition ${
                        isActive ? "bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20" : "bg-transparent hover:bg-[var(--hairline)]"
                      } ${isDragging && draggingHandle?.edge === "start" ? "!bg-[var(--primary)]" : ""}`}
                      aria-label={`Adjust start time for segment ${seg.text.slice(0, 20) || seg.id.slice(0, 6)}`}
                      role="slider"
                      aria-valuemin={0}
                      aria-valuemax={seg.endMs}
                      aria-valuenow={seg.startMs}
                    >
                      <span aria-hidden className={`h-3 w-px rounded-full ${isActive ? "bg-[var(--primary)]" : "bg-[var(--muted)]"} shadow`} />
                      <span aria-hidden className="ml-px h-3 w-px rounded-full bg-[var(--muted)]/60 hidden sm:block" />
                    </span>

                    {/* Right handle */}
                    <span
                      data-handle="right"
                      onPointerDown={(e) => handleEdgePointerDown(e, seg.id, "end")}
                      className={`absolute right-0 top-0 bottom-0 flex w-[10px] cursor-col-resize items-center justify-center rounded-r-[6px] transition ${
                        isActive ? "bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20" : "bg-transparent hover:bg-[var(--hairline)]"
                      } ${isDragging && draggingHandle?.edge === "end" ? "!bg-[var(--primary)]" : ""}`}
                      aria-label={`Adjust end time for segment ${seg.text.slice(0, 20) || seg.id.slice(0, 6)}`}
                      role="slider"
                      aria-valuemin={seg.startMs}
                      aria-valuemax={durationMs}
                      aria-valuenow={seg.endMs}
                    >
                      <span aria-hidden className={`h-3 w-px rounded-full ${isActive ? "bg-[var(--primary)]" : "bg-[var(--muted)]"}`} />
                      <span aria-hidden className="ml-px h-3 w-px rounded-full bg-[var(--muted)]/60 hidden sm:block" />
                    </span>
                  </div>
                );
              })}

              {/* Empty state helper when no segments */}
              {sorted.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full border border-dashed border-[var(--hairline-strong)] bg-[var(--surface-card)] px-2.5 py-1 text-[11px] text-[var(--muted)]">No segments</span>
                </div>
              )}
            </div>
          </div>

          {/* Playhead — ink for light canvas */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 flex flex-col items-center"
            style={{ left: playheadPx, transform: "translateX(-50%)" }}
            aria-hidden
          >
            {/* top cap */}
            <span className="h-2 w-2 rotate-45 bg-[var(--primary)] shadow-[0_1px_4px_rgba(0,0,0,0.16)] mt-0" />
            {/* line */}
            <span className="w-px flex-1 bg-[var(--primary)] shadow-[0_0_6px_rgba(12,10,9,0.12)]" />
            {/* bottom dot */}
            <span className="mb-[10px] h-1.5 w-1.5 rounded-full bg-[var(--primary)] shadow-[0_1px_6px_rgba(12,10,9,0.14)]" />
          </div>

          {/* Draggable hit area for playhead (invisible but larger) */}
          <div
            className={`absolute top-0 bottom-0 z-30 cursor-ew-resize touch-none ${draggingPlayhead ? "bg-[var(--primary)]/[0.04]" : "hover:bg-[var(--primary)]/[0.03]"}`}
            style={{ left: Math.max(0, playheadPx - 12), width: 24 }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDraggingPlayhead(true);
              try {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              } catch {}
            }}
            onPointerMove={(e) => {
              if (!draggingPlayhead) return;
              const rect = timelineRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left;
              const ms = pxToTime(x);
              seekTo(ms);
            }}
            onPointerUp={(e) => {
              setDraggingPlayhead(false);
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {}
            }}
            aria-label="Drag playhead to seek"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={durationMs || 0}
            aria-valuenow={Math.round(currentTimeMs)}
          />

          {/* Progress fill (subtle) behind segments but above waveform base — ink wash */}
          <div
            className="pointer-events-none absolute left-0 top-0 bottom-[10px] bg-[var(--primary)]/[0.06] border-r border-[var(--primary)]/20"
            style={{ width: playheadPx }}
            aria-hidden
          />
        </div>

        {/* Bottom ruler ticks + time labels */}
        <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-[10px] flex justify-between px-1" aria-hidden>
          <span className="font-mono text-[9px] leading-none text-[var(--muted)]">{formatDuration(0)}</span>
          <span className="font-mono text-[9px] leading-none text-[var(--muted)]">{formatDuration(durationMs || 0)}</span>
        </div>
      </div>

      {/* Footer meta bar — light hairline */}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] px-3 py-1.5">
        <span className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span className="hidden sm:inline font-medium tracking-wide text-[var(--ink)]">WAVEFORM</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-strong)] px-2 py-0.5 font-mono text-[10px]">
            <span className={`h-1.5 w-1.5 rounded-full ${waveformLoading ? "bg-[var(--primary)] animate-pulse" : "bg-[var(--semantic-success)]"}`} />
            {waveformLoading ? "Decoding…" : `${waveform.length || 0} pts · ${sorted.length} segs`}
          </span>
          <span className="hidden sm:inline text-[10px]">{durationMs ? `${(durationMs / 1000).toFixed(1)}s` : "—"}</span>
          <span className="hidden lg:inline text-[10px] text-[var(--muted)]/80">Click timeline to seek · Drag handle to trim · Drag playhead</span>
        </span>

        {/* Playback position */}
        <span className="flex items-center gap-2">
          <span className="hidden sm:inline font-mono text-[11px] tabular-nums text-[var(--ink)]">
            {formatDuration(currentTimeMs)} / {formatDuration(durationMs || 0)}
          </span>
          <span className="hidden sm:inline h-3 w-px bg-[var(--hairline-soft)]" aria-hidden />
          <span
            className="inline-flex h-5 items-center justify-center rounded-full bg-[var(--surface-strong)] px-2 font-mono text-[10px] font-medium text-[var(--primary)] border border-[var(--hairline)]"
            aria-label={`Playback progress ${Math.round(progressPercent)}%`}
          >
            {Math.round(progressPercent)}%
          </span>
          {draggingHandle && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,158,11,0.10)] border border-[var(--warning)]/30 px-2 py-0.5 text-[10px] font-medium text-[var(--warning)] animate-pulse">
              Trimming…
            </span>
          )}
        </span>
      </div>

      {/* Horizontal scroll hint for long videos */}
      {timelineWidth > (containerWidth || 0) + 10 && (
        <div className="pointer-events-none absolute bottom-[32px] right-2 hidden sm:flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-card)]/90 px-2 py-1 text-[10px] text-[var(--muted)] shadow-[var(--shadow-soft)] backdrop-blur">
          <span aria-hidden>⇄</span> Scroll to see more
        </div>
      )}
    </div>
  );
}
