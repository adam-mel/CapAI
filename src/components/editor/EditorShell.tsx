"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useEditor } from "@/context/EditorContext";
import VideoPlayer from "./VideoPlayer";
import CaptionList from "./CaptionList";
import StylePanel from "./StylePanel";
import Waveform from "./Waveform";
import ExportModal from "@/components/modals/ExportModal";
import { getVideoMetadata } from "@/lib/export";

interface EditorShellProps {
  captionListSlot?: React.ReactNode;
  stylePanelSlot?: React.ReactNode;
  waveformSlot?: React.ReactNode;
}

/**
 * EditorShell — 3-col layout shell per PRD §4.5
 * Top header + 3 columns (player 50% | caption 30% | style 20% collapsible)
 * Responsive per §9
 */
export default function EditorShell({ captionListSlot, stylePanelSlot, waveformSlot }: EditorShellProps) {
  const ctx = useEditor();
  const { project, settings, setSettings, saveState, revertToOriginal, activeSegmentId, durationMs, segments, captionStyle } = ctx;
  const [isStyleCollapsed, setIsStyleCollapsed] = useState(false);
  const [isWaveformCollapsed, setIsWaveformCollapsed] = useState(true); // default collapsed per spec
  const [showMobileStyle, setShowMobileStyle] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);

  // Robust dims capture: video element loadedmetadata + blob metadata (reliable for 1080x1920 vertical)
  // - Listens to loadedmetadata on video element when it mounts (no polling race)
  // - Also computes dims directly from project.videoBlob via getVideoMetadata on project load (ground truth)
  useEffect(() => {
    let cancelled = false;
    let el: HTMLVideoElement | null = null;
    let onLoaded: (() => void) | null = null;
    let retryId: number | null = null;

    const captureFromEl = (): boolean => {
      const v = ctx.videoRef.current;
      if (v && v.videoWidth && v.videoHeight) {
        if (!cancelled) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
        return true;
      }
      return false;
    };

    const attachListener = (): boolean => {
      const v = ctx.videoRef.current;
      if (!v) return false;
      el = v;
      onLoaded = () => {
        // Use videoWidth/Height directly (correct for rotation; 1080x1920 stays 1080x1920)
        if (v.videoWidth && v.videoHeight && !cancelled) {
          setVideoDims({ w: v.videoWidth, h: v.videoHeight });
        }
      };
      v.addEventListener("loadedmetadata", onLoaded);
      v.addEventListener("loadeddata", onLoaded);
      if (v.readyState >= 1) {
        // metadata already available
        onLoaded();
      } else {
        captureFromEl();
      }
      return true;
    };

    // Try immediate attach; if video element not yet mounted, retry briefly via timeout chain (no interval polling)
    if (!attachListener()) {
      let attempts = 0;
      const tick = () => {
        if (cancelled) return;
        if (attachListener() || captureFromEl()) return;
        attempts += 1;
        if (attempts < 40) {
          retryId = window.setTimeout(tick, 120) as unknown as number;
        }
      };
      retryId = window.setTimeout(tick, 120) as unknown as number;
    } else {
      captureFromEl();
    }

    // Reliable fallback/source: derive from blob via getVideoMetadata (handles case where video element is null at export time)
    const blob = project?.videoBlob as Blob | undefined;
    if (blob && blob.size > 0) {
      getVideoMetadata(blob)
        .then((meta) => {
          if (cancelled) return;
          if (meta.width && meta.height && meta.width >= 320 && meta.height >= 240) {
            setVideoDims((prev) => {
              if (!prev || prev.w !== meta.width || prev.h !== meta.height) {
                return { w: meta.width, h: meta.height };
              }
              return prev;
            });
          }
        })
        .catch((e) => {
          // BUG-UI-9 fix: don't swallow silently — surface warning so 16:9 fallback doesn't persist invisibly
          console.warn("[EditorShell] getVideoMetadata failed — videoDims stays null, will remain 16:9 fallback until element metadata loads", e);
          if (!cancelled) setVideoDims(null);
        });
    }

    return () => {
      cancelled = true;
      if (retryId !== null) window.clearTimeout(retryId);
      if (el && onLoaded) {
        el.removeEventListener("loadedmetadata", onLoaded);
        el.removeEventListener("loadeddata", onLoaded);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx.videoRef is stable ref; include id/blob only to re-run when project changes
  }, [project?.id, project?.videoBlob]);

  // Close mobile sheet on escape
  useEffect(() => {
    if (!showMobileStyle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMobileStyle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showMobileStyle]);

  // Prevent body scroll when sheet open — counter based (UI-21)
  useEffect(() => {
    if (!showMobileStyle) return;
    const g = globalThis as unknown as { __capaiLockCount?: number; __capaiLockPrev?: string };
    g.__capaiLockCount = (g.__capaiLockCount ?? 0) + 1;
    if (g.__capaiLockCount === 1) {
      g.__capaiLockPrev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      const gg = globalThis as unknown as { __capaiLockCount?: number; __capaiLockPrev?: string };
      gg.__capaiLockCount = Math.max(0, (gg.__capaiLockCount ?? 1) - 1);
      if (gg.__capaiLockCount === 0) document.body.style.overflow = gg.__capaiLockPrev ?? "";
    };
  }, [showMobileStyle]);

  const mode = settings.mode;

  const toggleMode = () => {
    setSettings((prev) => ({ ...prev, mode: prev.mode === "dynamic" ? "static" : "dynamic" }));
  };

  const handleRevert = () => {
    revertToOriginal();
    setShowRevertConfirm(false);
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)] lg:h-[calc(100vh-64px)] lg:max-h-[calc(100vh-64px)] lg:min-h-0 lg:overflow-hidden lg:max-w-full">
      {/* Secondary toolbar — 48px, in-flow shrink-0 (not sticky) so it naturally sits below SiteHeader (64px) inside flex column; video starts at 112px below viewport top with no overlap. Solid bg-[var(--canvas)] prevents bleed. */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--hairline)] bg-[var(--canvas)] px-3 sm:px-4 lg:px-6">
        {/* Left: back + filename */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-strong)] text-[13px] leading-none text-[var(--ink)] transition hover:bg-[var(--surface-card)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            aria-label="Back to dashboard"
          >
            ←
          </Link>
          <span className="hidden h-4 w-px bg-[var(--hairline)] sm:inline-block" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-[500] text-[var(--ink)] max-w-[16ch] sm:max-w-[22ch] lg:max-w-[28ch]" title={project?.name}>
              {project?.name ?? "video.mp4"}
            </p>
            <p className="hidden text-xs text-[var(--muted)] sm:block">
              {project?.settings.language.toUpperCase() ?? "EN"} · {project?.segments.length ?? 0} segments
            </p>
          </div>
        </div>

        {/* Center: mode toggle pill — fixed widths to prevent layout shift when toggling Dynamic ↔ Static */}
        <div className="hidden shrink-0 items-center justify-center gap-2 sm:flex">
          <div className="flex w-[184px] shrink-0 items-center justify-between rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] p-0.5">
            <button
              type="button"
              onClick={() => setSettings((p) => ({ ...p, mode: "dynamic" }))}
              className={`flex flex-1 items-center justify-center rounded-full px-2 py-1 text-xs font-medium transition ${mode === "dynamic" ? "bg-[var(--primary)] text-[var(--on-primary)] shadow" : "text-[var(--ink)] hover:text-[var(--ink)]"}`}
              aria-pressed={mode === "dynamic"}
            >
              Dynamic
            </button>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[10px] text-[var(--muted)]" aria-hidden>
              ↔
            </span>
            <button
              type="button"
              onClick={() => setSettings((p) => ({ ...p, mode: "static" }))}
              className={`flex flex-1 items-center justify-center rounded-full px-2 py-1 text-xs font-medium transition ${mode === "static" ? "bg-[var(--primary)] text-[var(--on-primary)] shadow" : "text-[var(--ink)] hover:text-[var(--ink)]"}`}
              aria-pressed={mode === "static"}
            >
              Static
            </button>
          </div>
          <button
            type="button"
            onClick={toggleMode}
            className="inline-flex h-6 w-[52px] shrink-0 items-center justify-center text-xs text-[var(--muted)] underline decoration-[var(--hairline-strong)] underline-offset-2 hover:text-[var(--ink)]"
            title="Toggle mode"
          >
            Switch
          </button>
        </div>

        {/* Right: saved + revert + export + style toggle (mobile/tablet) */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Saved indicator — fixed w-[108px] + absolute overlay prevents width shift between Saved (5 chars) and Saving… (8 chars + spinner) */}
          <div
            className="relative hidden h-7 w-[108px] shrink-0 items-center justify-center sm:flex"
            aria-live="polite"
            aria-atomic="true"
          >
            {/* Saving — spinner + text */}
            <span
              className={`absolute inset-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] px-2.5 py-1 text-xs text-[var(--ink)] transition-opacity duration-150 ${saveState === "saving" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState !== "saving"}
            >
              <span className="h-2 w-2 shrink-0 animate-spin rounded-full border-2 border-[var(--primary)]/30 border-t-[var(--primary)]" aria-hidden />
              Saving…
            </span>
            {/* Saved — success pill */}
            <span
              className={`absolute inset-0 inline-flex items-center justify-center gap-1 rounded-full border border-[rgba(34,197,94,0.18)] bg-[rgba(34,197,94,0.08)] px-2.5 py-1 text-xs font-medium text-[var(--semantic-success)] transition-opacity duration-150 ${saveState === "saved" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState !== "saved"}
            >
              Saved ✓
            </span>
            {/* Idle — occupies same box so Revert/Export never shift */}
            <span
              className={`absolute inset-0 inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs text-[var(--muted)] transition-opacity duration-150 ${saveState === "idle" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState !== "idle"}
            >
              Saved
            </span>
          </div>

          {/* Mobile saved dot — light */}
          <span
            className={`h-2 w-2 shrink-0 rounded-full sm:hidden ${saveState === "saving" ? "bg-[var(--primary)] animate-pulse" : saveState === "saved" ? "bg-[var(--semantic-success)]" : "bg-[var(--hairline-strong)]"}`}
            aria-hidden
            title={saveState}
          />

          {/* Style button for mobile/tablet — 44px min tap target per PRD §9.2 */}
          <button
            type="button"
            onClick={() => setShowMobileStyle(true)}
            className="inline-flex h-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)] lg:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            aria-label="Open style panel"
          >
            <span className="mr-1 text-[13px]" aria-hidden>
              ◈
            </span>
            Style
          </button>

          <div className="hidden h-5 w-px bg-[var(--hairline-soft)] sm:block" aria-hidden />

          <button
            type="button"
            onClick={() => setShowRevertConfirm(true)}
            aria-label="Revert captions to original"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-[9999px] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>⟳</span>
            <span className="hidden sm:inline">Revert</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            aria-label={`Export video ${project?.name ?? "video.mp4"}`}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] hover:bg-[var(--primary-active)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            Export
            <span aria-hidden>→</span>
          </button>
        </div>
      </header>

      {/* Main content — fixed at lg: h fills remaining outer height minus 48px toolbar, no min-h calc. Mobile natural scroll (no overflow-hidden). Row flex-1 min-h-0 items-stretch fills height; waveform shrink-0 sits flush with no gap. */}
      <main id="main-content" className="flex flex-1 min-h-0 min-w-0 flex-col bg-[var(--canvas)] p-3 sm:p-4 lg:p-4 gap-3 lg:gap-3 lg:min-h-0 lg:overflow-hidden lg:max-h-full">
        {/* Mobile mode toggle row (visible only <sm) — fixed widths prevent shift */}
        <div className="flex items-center justify-center gap-2 border border-[var(--hairline)] bg-[var(--surface-card)] rounded-[var(--radius-xl)] px-3 py-2 sm:hidden shadow-[var(--shadow-soft)]">
          <div className="flex w-[160px] shrink-0 items-center justify-between rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] p-0.5">
            <button
              type="button"
              onClick={() => setSettings((p) => ({ ...p, mode: "dynamic" }))}
              aria-pressed={mode === "dynamic"}
              aria-label="Set mode to Dynamic"
              className={`flex flex-1 items-center justify-center rounded-full px-2 py-1 text-xs font-medium ${mode === "dynamic" ? "bg-[var(--primary)] text-[var(--on-primary)] shadow" : "text-[var(--ink)]"}`}
            >
              Dynamic
            </button>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[10px] text-[var(--muted)]" aria-hidden>
              ↔
            </span>
            <button
              type="button"
              onClick={() => setSettings((p) => ({ ...p, mode: "static" }))}
              aria-pressed={mode === "static"}
              aria-label="Set mode to Static"
              className={`flex flex-1 items-center justify-center rounded-full px-2 py-1 text-xs font-medium ${mode === "static" ? "bg-[var(--primary)] text-[var(--on-primary)] shadow" : "text-[var(--ink)]"}`}
            >
              Static
            </button>
          </div>
          {/* Fixed w-[72px] overlay so Saving… / Saved ✓ don't push pill */}
          <div className="relative flex h-5 w-[72px] shrink-0 items-center justify-center">
            <span
              className={`absolute inset-0 inline-flex items-center justify-center text-xs text-[var(--muted)] transition-opacity ${saveState === "saving" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState !== "saving"}
            >
              Saving…
            </span>
            <span
              className={`absolute inset-0 inline-flex items-center justify-center text-xs font-medium text-[var(--semantic-success)] transition-opacity ${saveState === "saved" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState !== "saved"}
            >
              Saved ✓
            </span>
            <span
              className={`absolute inset-0 inline-flex items-center justify-center text-xs text-[var(--muted)] transition-opacity ${saveState !== "saving" && saveState !== "saved" ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={saveState === "saving" || saveState === "saved"}
            >
              Saved
            </span>
          </div>
        </div>

        {/* Main 3-col area — flex-1 min-h-0 lg:items-stretch so Video shrink-0 + Caption flex-1 fill row height; waveform shrink-0 flush below */}
        <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-3 lg:min-h-0 lg:overflow-hidden lg:max-h-full">
          {/* Left+Center wrapper — flex-1 min-h-0 items-stretch: Video self-start natural h-auto, Caption flex-1 self-stretch fills height */}
          <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3 sm:flex-row lg:flex-row lg:items-stretch lg:gap-3 lg:min-h-0 lg:overflow-hidden lg:max-h-full">
            {/* Video Player — scroll fix: shrink-0 flex-none h-auto (not flex-1) so card sizes to video content and never leaves white gap. At lg, self-start prevents stretch; inner stage handles portrait via aspectRatio without flex-1 height-0 trick. */}
            <section
              className={`flex shrink-0 flex-none flex-col items-stretch overflow-hidden bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] w-full sm:w-[60%] p-3 lg:p-3 lg:shrink-0 lg:flex-none lg:self-start ${isStyleCollapsed ? "lg:w-[58%] xl:w-[56%]" : "lg:w-[52%] xl:w-[52%]"}`}
              aria-label="Video player"
            >
              <div className="flex w-full shrink-0 justify-center overflow-hidden">
                <VideoPlayer videoDims={videoDims} />
              </div>
              <p className="mt-3 hidden text-center text-[11px] text-[var(--muted)] sm:block">
                Click caption row to seek & play · Captions rendered on canvas
                {activeSegmentId && <span className="ml-2 font-mono text-[var(--primary)]">● {activeSegmentId.slice(0, 6)}</span>}
              </p>
            </section>

            {/* Caption List — scroll fix: flex-1 min-h-0 with overflow-hidden at lg and internal overflow-y-auto (CaptionList's listRef). Mobile keeps min-h-[320px] for usability but allows page scroll; at lg, flex-1 + min-h-0 + lg:overflow-hidden lets 73 segments scroll internally without page white. */}
            <section
              id="caption-list-slot"
              className="flex flex-1 min-h-[320px] flex-col bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] overflow-hidden sm:min-h-0 sm:w-[40%] lg:w-auto lg:flex-1 lg:min-h-0 lg:max-h-full lg:self-stretch lg:overflow-hidden"
              aria-label="Caption list"
            >
              {captionListSlot ?? <CaptionList />}
            </section>
          </div>

          {/* Style Panel — in-flow rail when collapsed (shrink-0 flex item, sticky) → guarantees 16px gap, never overlays captions */}
          <aside
            id="style-panel-slot"
            className={
              isStyleCollapsed
                ? "hidden lg:flex lg:flex-col shrink-0 w-[56px] self-start sticky top-[88px] h-[calc(100vh-88px-24px)] min-h-0 overflow-hidden bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)]"
                : "hidden lg:flex lg:flex-col shrink-0 lg:w-[20%] lg:min-w-[320px] lg:max-w-[380px] bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] min-h-0 overflow-hidden lg:min-h-0 lg:h-[calc(100vh-88px-24px)] lg:max-h-[calc(100vh-88px-24px)] lg:overflow-hidden self-start lg:sticky lg:top-[88px]"
            }
            aria-label="Style panel"
          >
            {stylePanelSlot ? (
              <div className="flex max-h-full flex-1 min-h-0 flex-col overflow-hidden">
                <div className="flex-1 min-h-0 max-h-full overflow-y-auto overflow-x-hidden overscroll-contain">{stylePanelSlot}</div>
              </div>
            ) : (
              <StylePanel collapsed={isStyleCollapsed} onCollapsedChange={setIsStyleCollapsed} />
            )}
          </aside>
          {/* FAB removed — collapsed rail already contains its own expand button (mt-3 ›) at top of rail; duplicate FAB at right-6 bottom-6 overlapped rail bottom edge when collapsed. Hidden to prevent incursion while preserving expand affordance via rail. */}
        </div>

        {/* Waveform strip collapsible — shrink-0 mt-0 sits directly below row via main gap-3; hidden on mobile per PRD §9.1 — no extra margin */}
        <div className="hidden shrink-0 mt-0 bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] overflow-hidden relative sm:block">
          {/* subtle atmospheric orbs behind waveform */}
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.22)_0%,transparent_70%)] blur-[1px]" aria-hidden />
          <div className="pointer-events-none absolute -left-10 -bottom-10 h-32 w-32 rounded-full bg-[radial-gradient(circle_at_center,rgba(244,197,168,0.18)_0%,transparent_70%)] blur-[1px]" aria-hidden />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(200,184,224,0.14)_0%,transparent_70%)] blur-[1px]" aria-hidden />
          <div className="relative flex items-center justify-between px-4 py-2.5 border-b border-[var(--hairline-soft)]">
            <span className="text-xs font-semibold tracking-widest text-[var(--ink)]">WAVEFORM</span>
            <button
              type="button"
              onClick={() => setIsWaveformCollapsed((v) => !v)}
              aria-expanded={!isWaveformCollapsed}
              aria-label={isWaveformCollapsed ? "Expand waveform" : "Collapse waveform"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-xs text-[var(--ink)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            >
              <span aria-hidden="true">{isWaveformCollapsed ? "∧" : "∨"}</span>
            </button>
          </div>
          {!isWaveformCollapsed ? (
            <div id="waveform-slot" className="relative">
              {waveformSlot ?? <Waveform />}
            </div>
          ) : null}
          {/* when collapsed, keep a thin hint bar */}
          {isWaveformCollapsed && <div className="h-1 bg-[var(--canvas-soft)]" aria-hidden="true" />}
        </div>
      </main>

      {/* Mobile / Tablet Style Bottom Sheet / Drawer — light editorial */}
      {showMobileStyle && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end sm:justify-center sm:items-end sm:p-6 lg:hidden">
          <button type="button" aria-label="Close style panel" className="absolute inset-0 bg-[rgba(12,10,9,0.18)] backdrop-blur-[6px]" onClick={() => setShowMobileStyle(false)} />
          <div className="relative flex max-h-[78vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-elevated)] sm:max-h-[86vh] sm:w-[380px] sm:rounded-[var(--radius-xl)]">
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
              <span className="h-1 w-9 rounded-full bg-[var(--hairline-strong)]" />
            </div>
            <div className="flex items-center justify-between border-b border-[var(--hairline-soft)] bg-[var(--surface-card)] px-4 py-3">
              <h2 className="text-[16px] font-[500] text-[var(--ink)]">Style</h2>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-[var(--muted)] sm:inline">{project?.captionStyle.preset ?? "Custom"}</span>
                <button
                  type="button"
                  onClick={() => setShowMobileStyle(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] text-sm text-[var(--ink)] hover:bg-[var(--surface-card)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                  aria-label="Close style panel"
                >
                  <span aria-hidden>✕</span>
                </button>
              </div>
            </div>
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                {stylePanelSlot ? (
                  stylePanelSlot
                ) : (
                  <StylePanel hideHeader />
                )}
              </div>
            </div>
            <div className="border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] p-3">
              <button
                type="button"
                onClick={() => setShowMobileStyle(false)}
                className="flex w-full h-11 min-h-[44px] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] text-sm font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revert confirmation dialog — light card */}
      {showRevertConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-[rgba(12,10,9,0.32)] backdrop-blur-[6px]" onClick={() => setShowRevertConfirm(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="revert-title" className="relative w-full max-w-[420px] rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-elevated)]">
            <h3 id="revert-title" className="text-[16px] font-[500] text-[var(--ink)]">
              Revert to AI Original?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--body)]">
              This will reset all captions to the first Gemini output. Your edits will be lost and cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRevertConfirm(false)}
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevert}
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--semantic-error)] px-4 text-sm font-medium text-white hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--semantic-error)]"
              >
                Revert Captions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky export bar on mobile — light editorial 44px min tap */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-[var(--hairline)] bg-[var(--surface-card)]/95 px-3 py-2 backdrop-blur-xl shadow-[var(--shadow-soft)] sm:hidden">
        <span className="text-xs text-[var(--muted)]">{project?.segments.length ?? 0} segments · {settings.mode}</span>
        <button
          type="button"
          onClick={() => setIsExportOpen(true)}
          aria-label={`Export video ${project?.name ?? "video.mp4"}`}
          className="inline-flex h-11 min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          Export <span aria-hidden>→</span>
        </button>
      </div>

      {/* Export modal — 3-step PRD §4.7 */}
      {project && (
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          projectName={project.name}
          durationMs={durationMs}
          mode={settings.mode}
          highlightStyle={captionStyle.highlightStyle}
          segments={segments}
          style={captionStyle}
          videoBlob={project.videoBlob as Blob}
          videoWidth={videoDims?.w}
          videoHeight={videoDims?.h}
        />
      )}
    </div>
  );
}


