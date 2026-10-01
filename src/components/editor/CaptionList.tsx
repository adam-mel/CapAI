"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/context/EditorContext";
import { useCaptionOperations } from "@/hooks/useCaptionOperations";
import CaptionRow from "./CaptionRow";
import type { CaptionSegment } from "@/lib/types";

/**
 * CaptionList — Center panel per PRD §4.5.2
 * Search + Add Seg + scrollable rows + segment operations
 */
export default function CaptionList() {
  const ctx = useEditor();
  const { segments, currentTimeMs, activeSegmentId, seekTo, play, setIsEditing } = ctx;
  const ops = useCaptionOperations();

  const [searchQuery, setSearchQuery] = useState("");
  const [autoFocusTarget, setAutoFocusTarget] = useState<{ id: string; wordIdx: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sorted segments by startMs for display (context keeps sorted, but ensure)
  const sortedSegments = useMemo(() => [...segments].sort((a, b) => a.startMs - b.startMs), [segments]);

  // Keep isEditing flag in context in sync with any row editing
  const handleRowEditingChange = useCallback(
    (isEditing: boolean) => {
      setIsEditing(isEditing);
    },
    [setIsEditing]
  );

  // Clear autoFocus after short delay
  useEffect(() => {
    if (!autoFocusTarget) return;
    const t = window.setTimeout(() => setAutoFocusTarget(null), 800);
    return () => window.clearTimeout(t);
  }, [autoFocusTarget]);

  // Row seek + play
  const handleSeek = useCallback(
    (seg: CaptionSegment) => {
      // Do not move playhead during search typing? Spec says video playhead does NOT move during search —
      // that only means typing in search box shouldn't seek; our seek is explicit row click, so allow.
      seekTo(seg.startMs);
      // start playback per spec
      window.setTimeout(() => play(), 0);
    },
    [seekTo, play]
  );

  // Add segment at playhead
  const handleAddSeg = useCallback(() => {
    const newId = ops.addSegment();
    if (newId) {
      // Auto-focus the new blank segment's text input
      // Give React a tick to mount the row before focusing
      window.setTimeout(() => {
        setAutoFocusTarget({ id: newId, wordIdx: 0 });
        // Also scroll it into view after next render
        window.setTimeout(() => {
          const el = document.querySelector(`[data-segment-id="${newId}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 30);
      }, 30);
    }
  }, [ops]);

  // Word update (single word inline edit)
  const handleWordUpdate = useCallback(
    (id: string, wordIndex: number, newWord: string) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      if (wordIndex < 0 || wordIndex >= seg.words.length) return;
      const words = seg.words.map((w, i) => (i === wordIndex ? { ...w, word: newWord } : { ...w }));
      const text = words.map((w) => w.word).join(" ");
      const confidences = words.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
      ctx.updateSegment(id, {
        text,
        words,
        confidence: confidences.length ? Math.min(...confidences) : undefined,
      });
    },
    [segments, ctx]
  );

  const handleEmptyTextSubmit = useCallback(
    (id: string, text: string) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      const raw = text.trim();
      if (!raw) return;
      const parts = raw.split(/\s+/);
      const dur = Math.max(500, seg.endMs - seg.startMs);
      const slice = dur / parts.length;
      const words = parts.map((w, i) => ({
        word: w,
        startMs: Math.round(seg.startMs + i * slice),
        endMs: Math.round(seg.startMs + (i + 1) * slice),
        confidence: 1 as number,
      }));
      ctx.updateSegment(id, {
        text: parts.join(" "),
        words,
        confidence: 1,
      });
    },
    [segments, ctx]
  );

  const handleTimestampUpdate = useCallback(
    (id: string, startMs: number, endMs: number) => {
      ctx.updateSegment(id, { startMs, endMs });
    },
    [ctx]
  );

  const handleRequestFocusNext = useCallback(
    (currentId: string) => {
      const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
      const idx = sorted.findIndex((s) => s.id === currentId);
      if (idx !== -1 && idx < sorted.length - 1) {
        const nxt = sorted[idx + 1];
        setAutoFocusTarget({ id: nxt.id, wordIdx: 0 });
        // scroll next into view
        window.setTimeout(() => {
          const el = document.querySelector(`[data-segment-id="${nxt.id}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 30);
      }
    },
    [segments]
  );

  // Split / Merge / Delete wrappers
  const handleSplit = useCallback(
    (id: string) => {
      const ok = ops.splitSegment(id);
      if (!ok) {
        // Optional: could toast "Cannot split" — for now silently ignore or flash
      }
    },
    [ops]
  );
  const handleMerge = useCallback(
    (id: string) => {
      ops.mergeSegment(id);
    },
    [ops]
  );
  const handleDelete = useCallback(
    (id: string) => {
      ops.deleteSegment(id);
    },
    [ops]
  );
  const handleCopy = useCallback(
    (id: string) => {
      ops.copySegmentText(id);
    },
    [ops]
  );

  // Keyboard shortcuts for selected/active segment (S split, Del delete) when not editing + search not focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextEditing =
        ctx.isEditing ||
        (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
      // Don't handle segment shortcuts while typing in search or editing words
      if (isTextEditing) return;
      // Must have active segment
      if (!activeSegmentId) return;

      if (e.key === "s" || e.key === "S") {
        // Only plain S without modifiers per spec
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        ops.splitSegment(activeSegmentId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        ops.deleteSegment(activeSegmentId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSegmentId, ctx.isEditing, ops]);

  // Auto-scroll active segment into view during playback (not during search)
  useEffect(() => {
    if (searchQuery.trim()) return; // don't auto-scroll while searching per UX emphasis on search not moving playhead
    if (!activeSegmentId) return;
    const el = document.querySelector(`[data-segment-id="${activeSegmentId}"]`);
    if (el && listRef.current) {
      // Only scroll if element not already in viewport of list
      const list = listRef.current;
      const rect = el.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const isVisible = rect.top >= listRect.top && rect.bottom <= listRect.bottom;
      if (!isVisible) {
        // Use smooth only if user not manually scrolling? For now smooth.
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [activeSegmentId, searchQuery]);

  const hasSegments = sortedSegments.length > 0;
  const queryLower = searchQuery.trim().toLowerCase();
  const isSearching = queryLower.length > 0;

  // Count matching for header badge
  const matchingCount = useMemo(() => {
    if (!isSearching) return sortedSegments.length;
    return sortedSegments.filter((s) => s.text.toLowerCase().includes(queryLower) || s.words.some((w) => w.word.toLowerCase().includes(queryLower))).length;
  }, [sortedSegments, queryLower, isSearching]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-card)]">
      {/* Header — text-input spec */}
      <div className="flex items-center gap-2 border-b border-[var(--hairline-soft)] bg-[var(--surface-card)] p-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] leading-none text-[var(--muted)]" aria-hidden>
            🔍
          </span>
          <input
            ref={searchInputRef}
            id="capai-search-captions"
            name="searchCaptions"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setSearchQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search captions…"
            className="h-11 w-full rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] pl-9 pr-9 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none transition focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            aria-label="Search captions"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--surface-strong)] text-xs text-[var(--ink)] hover:bg-[var(--canvas-soft)]"
              aria-label="Clear search"
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleAddSeg}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-pill)] bg-[var(--primary)] px-4 text-xs font-[500] text-[var(--on-primary)] shadow-[var(--shadow-soft)] hover:bg-[var(--primary-active)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          title="Add blank segment at playhead (2s)"
          aria-label="Add segment at playhead - Add Seg"
        >
          <span aria-hidden className="text-[13px] leading-none">＋</span> Add Seg
        </button>
      </div>

      {/* List meta bar — UI-14 search badge aria-live */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--hairline-soft)] bg-[var(--surface-card)] px-3 py-1.5">
        <span aria-live="polite" aria-atomic="true" className="text-[11px] font-medium tracking-wide text-[var(--muted)]">
          {isSearching ? (
            <>
              <span className="font-mono text-[var(--warning)]">{matchingCount}</span>
              <span className="mx-1">/</span>
              <span>{sortedSegments.length}</span> matches
            </>
          ) : (
            <>{sortedSegments.length} segments</>
          )}
        </span>

        <span className="flex items-center gap-1.5">
          {/* Undo / Redo mini buttons — hairline-strong */}
          <button
            type="button"
            onClick={() => ops.undo()}
            disabled={!ops.canUndo}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-[6px] border text-[12px] leading-none transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
              ops.canUndo
                ? "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                : "cursor-not-allowed border-[var(--hairline-soft)] bg-transparent text-[var(--muted)] opacity-40"
            }`}
            title={ops.canUndo ? "Undo (Cmd+Z)" : "Nothing to undo"}
            aria-label="Undo"
          >
            <span aria-hidden>↶</span>
          </button>
          <button
            type="button"
            onClick={() => ops.redo()}
            disabled={!ops.canRedo}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-[6px] border text-[12px] leading-none transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
              ops.canRedo
                ? "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                : "cursor-not-allowed border-[var(--hairline-soft)] bg-transparent text-[var(--muted)] opacity-40"
            }`}
            title={ops.canRedo ? "Redo (Cmd+Shift+Z)" : "Nothing to redo"}
            aria-label="Redo"
          >
            <span aria-hidden>↷</span>
          </button>
          <span className="ml-1 hidden text-[11px] text-[var(--muted)] sm:inline">Ctrl+Z / Shift+Z</span>
        </span>
      </div>

      {/* Scrollable rows — scroll-fix: flex-1 min-h-0 overflow-y-auto so 73 segments (h6854) scroll internally inside lg:overflow-hidden parent; min-h-0 prevents flex blowout. overscroll-contain prevents page scroll chaining. */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--canvas)] p-2 lg:min-h-0 lg:overflow-y-auto" role="list" aria-label="Caption segments">
        {!hasSegments ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--hairline)] bg-[var(--surface-card)] p-8 text-center shadow-[var(--shadow-soft)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] text-[var(--muted)]">◎</div>
            <div>
              <p className="text-sm font-[500] text-[var(--ink)]">No captions yet</p>
              <p className="mt-1 max-w-[28ch] text-xs leading-relaxed text-[var(--body)]">Generate captions from your video or add a segment at the playhead to start typing.</p>
            </div>
            <button
              type="button"
              onClick={handleAddSeg}
              aria-label="Add segment at playhead - Add Seg"
              className="mt-2 inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-xs font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)] shadow-[var(--shadow-soft)]"
            >
              <span aria-hidden>＋</span> Add Seg
            </button>
            <p className="mt-2 text-[11px] text-[var(--muted)]">Current time: {(currentTimeMs / 1000).toFixed(2)}s</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedSegments.map((seg, idx) => {
              const isActive = seg.id === activeSegmentId;
              const isLast = idx === sortedSegments.length - 1;
              const autoFocusWord = autoFocusTarget && autoFocusTarget.id === seg.id ? autoFocusTarget.wordIdx : null;
              return (
                <CaptionRow
                  key={seg.id}
                  segment={seg}
                  index={idx}
                  isActive={isActive}
                  isLast={isLast}
                  searchQuery={searchQuery}
                  onSeek={handleSeek}
                  onSplit={handleSplit}
                  onMerge={handleMerge}
                  onDelete={handleDelete}
                  onCopy={handleCopy}
                  onWordUpdate={handleWordUpdate}
                  onEmptyTextSubmit={handleEmptyTextSubmit}
                  onTimestampUpdate={handleTimestampUpdate}
                  autoFocusWord={autoFocusWord}
                  onRequestFocusNext={handleRequestFocusNext}
                  onEditingChange={handleRowEditingChange}
                />
              );
            })}
          </div>
        )}

        {/* Search empty helper when searching but all dimmed? Still show list, but hint */}
        {isSearching && matchingCount === 0 && hasSegments && (
          <div className="mt-3 rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] p-3 text-center shadow-[var(--shadow-soft)]">
            <p className="text-xs text-[var(--muted)]">No matches — rows dimmed for context.</p>
            <button type="button" onClick={() => setSearchQuery("")} className="mt-2 text-xs font-medium text-[var(--primary)] hover:underline">
              Clear search
            </button>
          </div>
        )}
      </div>

      {/* Footer helper — hairline-soft */}
      <div className="border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            Click row to seek & play · Click word to edit · <span className="font-mono">S</span> split · <span className="font-mono">Del</span> delete
          </p>
          <span className="hidden shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)] sm:inline">
            {(currentTimeMs / 1000).toFixed(2)}s
          </span>
        </div>
      </div>
    </div>
  );
}
