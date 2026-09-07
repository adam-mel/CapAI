"use client";

import React, { useEffect, useRef, useState } from "react";
import type { CaptionSegment, WordToken } from "@/lib/types";
import { formatTime, parseTime } from "@/lib/utils";

interface CaptionRowProps {
  segment: CaptionSegment;
  index: number;
  isActive: boolean;
  isLast: boolean;
  searchQuery: string;
  onSeek: (seg: CaptionSegment) => void;
  onSplit: (id: string) => void;
  onMerge: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  // UI-12 fix: align signatures — handler receives 3 args (id, idx, newWord); originalWord is internal
  onWordUpdate: (id: string, wordIndex: number, newWord: string) => void;
  onEmptyTextSubmit: (id: string, text: string) => void;
  onTimestampUpdate: (id: string, startMs: number, endMs: number) => void;
  autoFocusWord: number | null;
  onRequestFocusNext: (currentId: string) => void;
  onEditingChange?: (isEditing: boolean) => void;
}

function isLowConfidence(word: WordToken): boolean {
  return typeof word.confidence === "number" && word.confidence < 0.75;
}

function hasRowLowConfidence(seg: CaptionSegment): boolean {
  if (typeof seg.confidence === "number" && seg.confidence < 0.75) return true;
  return seg.words.some((w) => isLowConfidence(w));
}

function highlightMatch(word: string, query: string): React.ReactNode {
  if (!query.trim()) return word;
  const q = query.trim().toLowerCase();
  const lower = word.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return word;
  const before = word.slice(0, idx);
  const match = word.slice(idx, idx + q.length);
  const after = word.slice(idx + q.length);
  return (
    <>
      {before}
      <span className="rounded-[3px] bg-[rgba(245,158,11,0.35)] px-0.5 text-[var(--warning)] underline decoration-[var(--warning)] decoration-2 underline-offset-2">
        {match}
      </span>
      {after}
    </>
  );
}

export default function CaptionRow({
  segment,
  isActive,
  isLast,
  searchQuery,
  onSeek,
  onSplit,
  onMerge,
  onDelete,
  onCopy,
  onWordUpdate,
  onEmptyTextSubmit,
  onTimestampUpdate,
  autoFocusWord,
  onRequestFocusNext,
  onEditingChange,
}: CaptionRowProps) {
  const [editingWordIndex, setEditingWordIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [originalWord, setOriginalWord] = useState("");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingEmpty, setIsEditingEmpty] = useState(false);
  const [emptyValue, setEmptyValue] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const emptyInputRef = useRef<HTMLInputElement | null>(null);
  const startInputRef = useRef<HTMLInputElement | null>(null);
  const endInputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const [showMobileActions, setShowMobileActions] = useState(false);

  // Auto-focus word from parent (Enter -> next segment first word)
  useEffect(() => {
    if (autoFocusWord !== null && autoFocusWord !== undefined) {
      if (segment.words.length === 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-focus requires sync state update when prop changes
        setIsEditingEmpty(true);
        setEmptyValue("");
        setTimeout(() => emptyInputRef.current?.focus(), 20);
      } else {
        const idx = Math.max(0, Math.min(autoFocusWord, segment.words.length - 1));
        const w = segment.words[idx];
        setEditingWordIndex(idx);
        setEditingValue(w.word);
        setOriginalWord(w.word);
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 20);
      }
    }
  }, [autoFocusWord, segment.words]);

  useEffect(() => {
    onEditingChange?.(editingWordIndex !== null || isEditingTime || isEditingEmpty);
  }, [editingWordIndex, isEditingTime, isEditingEmpty, onEditingChange]);

  // Close menu on outside click
  useEffect(() => {
    if (!isMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isMenuOpen]);

  // Focus management for word edit
  useEffect(() => {
    if (editingWordIndex !== null) {
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 10);
      return () => window.clearTimeout(t);
    }
  }, [editingWordIndex]);

  useEffect(() => {
    if (isEditingEmpty) {
      const t = window.setTimeout(() => emptyInputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [isEditingEmpty]);

  useEffect(() => {
    if (isEditingTime) {
      const t = window.setTimeout(() => startInputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [isEditingTime]);

  const lowConf = hasRowLowConfidence(segment);
  const queryLower = searchQuery.trim().toLowerCase();
  const isMatching = !queryLower || segment.text.toLowerCase().includes(queryLower) || segment.words.some((w) => w.word.toLowerCase().includes(queryLower));

  const handleRowClick = (e: React.MouseEvent) => {
    // Ignore if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("[contenteditable]") ||
      target.closest("[data-word]") ||
      target.closest("[data-timestamp-edit]") ||
      target.closest("[data-menu]") ||
      target.closest("[data-actions]")
    ) {
      return;
    }
    // Ignore if editing
    if (editingWordIndex !== null || isEditingTime || isEditingEmpty) return;
    onSeek(segment);
  };

  const handleWordClick = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditingTime || isEditingEmpty) return;
    const w = segment.words[idx];
    setEditingWordIndex(idx);
    setEditingValue(w.word);
    setOriginalWord(w.word);
  };

  const handleWordConfirm = () => {
    if (editingWordIndex === null) return;
    const trimmed = editingValue.trim();
    // Empty => keep original? or delete word? Spec says Escape cancels, Enter confirms; if empty we keep original? We'll treat empty as cancel unless explicitly deleting
    if (!trimmed) {
      setEditingWordIndex(null);
      return;
    }
    if (trimmed === originalWord) {
      setEditingWordIndex(null);
      return;
    }
    onWordUpdate(segment.id, editingWordIndex, trimmed);
    const finishedIdx = editingWordIndex;
    setEditingWordIndex(null);
    // Move focus to next segment first word per spec
    // Do after state update via requestAnimationFrame
    if (finishedIdx !== null) {
      // Small delay to let segment update commit, then request next
      window.setTimeout(() => onRequestFocusNext(segment.id), 40);
    }
  };

  const handleWordCancel = () => {
    setEditingWordIndex(null);
    setEditingValue(originalWord);
  };

  const handleEmptyConfirm = () => {
    const trimmed = emptyValue.trim();
    if (!trimmed) {
      setIsEditingEmpty(false);
      return;
    }
    onEmptyTextSubmit(segment.id, trimmed);
    setIsEditingEmpty(false);
    setEmptyValue("");
    // Also move to next? Not needed, next will be next segment
    window.setTimeout(() => onRequestFocusNext(segment.id), 40);
  };

  const handleEmptyCancel = () => {
    setIsEditingEmpty(false);
    setEmptyValue("");
  };

  const handleTimestampClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditingTime) return;
    setIsEditingTime(true);
    setTimeStart(formatTime(segment.startMs));
    setTimeEnd(formatTime(segment.endMs));
  };

  const [timeError, setTimeError] = useState<string | null>(null);
  const handleTimestampConfirm = () => {
    const s = parseTime(timeStart);
    const en = parseTime(timeEnd);
    if (s === null || en === null) {
      setTimeError("Invalid time — use MM:SS.mmm e.g. 00:05.200");
      return;
    }
    if (s >= en) {
      setTimeError("Start must be before end");
      return;
    }
    setTimeError(null);
    if (s !== segment.startMs || en !== segment.endMs) {
      onTimestampUpdate(segment.id, s, en);
    }
    setIsEditingTime(false);
  };

  const handleTimestampCancel = () => {
    setIsEditingTime(false);
    setTimeError(null);
    setTimeStart(formatTime(segment.startMs));
    setTimeEnd(formatTime(segment.endMs));
  };

  // Long-press for mobile actions
  const handleTouchStart = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => setShowMobileActions(true), 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const handleTouchMove = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div
      ref={rowRef}
      data-segment-id={segment.id}
      onClick={handleRowClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      className={`group relative flex flex-col gap-1.5 rounded-[var(--radius-xl)] border px-3 py-3 text-left transition shadow-[var(--shadow-soft)]
        ${isActive ? "border-[var(--primary)] bg-[var(--surface-card)] shadow-[var(--shadow-card)] border-l-[3px] border-l-[var(--primary)]" : "border-[var(--hairline)] bg-[var(--surface-card)] border-l-[3px] border-l-transparent hover:bg-[var(--surface-strong)] hover:border-[var(--hairline-soft)]"}
        ${!isMatching ? "opacity-40" : "opacity-100"}
      `}
      role="listitem"
      tabIndex={-1}
      data-active={isActive ? "true" : "false"}
      aria-current={isActive ? "true" : undefined}
    >
      {/* Header: timestamp + badges + menu */}
      <div className="flex w-full items-center justify-between gap-2">
        {/* Left: dot + timestamp */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-[var(--primary)] shadow-[0_0_6px_rgba(12,10,9,0.16)]" : "bg-[var(--muted)]/60"}`}
            aria-hidden
          />
          {isEditingTime ? (
            <div data-timestamp-edit className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-1.5">
              <input
                ref={startInputRef}
                value={timeStart}
                onChange={(e) => { setTimeStart(e.target.value); if (timeError) setTimeError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleTimestampConfirm();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleTimestampCancel();
                  } else if (e.key === "Tab" && !e.shiftKey) {
                    // let tab naturally move to end input
                  }
                }}
                onBlur={() => {
                  // do not auto confirm on blur — wait for Enter or explicit ✓
                }}
                aria-invalid={timeError ? "true" : undefined}
                aria-describedby={timeError ? `time-error-${segment.id}` : undefined}
                className={`h-6 w-[78px] rounded-[6px] border bg-[var(--surface-card)] px-1.5 text-center font-mono text-[11px] text-[var(--ink)] outline-none focus:ring-1 ${timeError ? "border-[var(--semantic-error)] focus:ring-[var(--semantic-error)]" : "border-[var(--primary)] focus:ring-[var(--primary)]"}`}
                aria-label="Start time"
                placeholder="00:00.000"
              />
              <span className="font-mono text-[11px] text-[var(--muted)]">→</span>
              <input
                ref={endInputRef}
                value={timeEnd}
                onChange={(e) => { setTimeEnd(e.target.value); if (timeError) setTimeError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleTimestampConfirm();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleTimestampCancel();
                  }
                }}
                aria-invalid={timeError ? "true" : undefined}
                aria-describedby={timeError ? `time-error-${segment.id}` : undefined}
                className={`h-6 w-[78px] rounded-[6px] border bg-[var(--surface-card)] px-1.5 text-center font-mono text-[11px] text-[var(--ink)] outline-none focus:ring-1 ${timeError ? "border-[var(--semantic-error)] focus:ring-[var(--semantic-error)]" : "border-[var(--primary)] focus:ring-[var(--primary)]"}`}
                aria-label="End time"
                placeholder="00:00.000"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTimestampConfirm();
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] text-[11px] font-bold text-[var(--on-primary)] hover:bg-[var(--primary-active)]"
                aria-label="Confirm timestamp"
              >
                <span aria-hidden>✓</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTimestampCancel();
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[11px] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                aria-label="Cancel timestamp edit"
              >
                <span aria-hidden>✕</span>
              </button>
              </div>
              {timeError && <p id={`time-error-${segment.id}`} role="alert" className="text-[11px] text-[var(--semantic-error)]">{timeError}</p>}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleTimestampClick}
              className="inline-flex items-center gap-1 rounded-[6px] px-1 py-0.5 font-mono text-[11px] tabular-nums text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              title="Click to edit timestamps"
              aria-label={`Timestamp ${formatTime(segment.startMs)} to ${formatTime(segment.endMs)}, click to edit`}
            >
              <span>{formatTime(segment.startMs)}</span>
              <span className="text-[10px] opacity-70">→</span>
              <span>{formatTime(segment.endMs)}</span>
            </button>
          )}
        </div>

        {/* Right: warning + overflow menu — ⚠ badge semantic-error */}
        <span className="flex items-center gap-1.5 shrink-0">
          {lowConf && (
            <span
              className="inline-flex items-center justify-center rounded-full bg-[rgba(220,38,38,0.08)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--semantic-error)] ring-1 ring-[rgba(220,38,38,0.22)]"
              title="Low confidence — click words to correct"
              aria-label="Low confidence segment"
            >
              ⚠
            </span>
          )}
          <div className="relative" data-menu ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen((v) => !v);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-[13px] leading-none text-[var(--muted)] hover:border-[var(--hairline)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              aria-label={`More actions for segment ${segment.text.slice(0, 30) || "empty segment"}`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <span aria-hidden>···</span>
            </button>
            {isMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] py-1 shadow-[var(--shadow-elevated)]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onSplit(segment.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                >
                  <span aria-hidden className="text-[11px]">✂</span> Split
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isLast}
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (!isLast) onMerge(segment.id);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${isLast ? "text-[var(--muted)] opacity-50 cursor-not-allowed" : "text-[var(--ink)] hover:bg-[var(--surface-strong)]"}`}
                >
                  <span aria-hidden className="text-[11px]">⤓</span> Merge ↓
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onCopy(segment.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                >
                  <span aria-hidden className="text-[11px]">⎘</span> Copy text
                </button>
                <div className="mx-1 my-1 h-px bg-[var(--hairline-soft)]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onDelete(segment.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--semantic-error)] hover:bg-[rgba(220,38,38,0.06)]"
                >
                  <span aria-hidden className="text-[11px]">✕</span> Delete
                </button>
              </div>
            )}
          </div>
        </span>
      </div>

      {/* Text body */}
      <div className="min-w-0">
        {segment.words.length === 0 ? (
          isEditingEmpty ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                ref={emptyInputRef}
                value={emptyValue}
                onChange={(e) => setEmptyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleEmptyConfirm();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleEmptyCancel();
                  }
                }}
                onBlur={() => {
                  // confirm on blur if has value
                  if (emptyValue.trim()) handleEmptyConfirm();
                  else handleEmptyCancel();
                }}
                placeholder="Type caption text..."
                className="h-11 flex-1 rounded-[8px] border border-[var(--primary)] bg-[var(--surface-card)] px-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <button
                type="button"
                onClick={handleEmptyConfirm}
                aria-label="Confirm caption text"
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] px-3 text-xs font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)]"
              >
                <span aria-hidden>✓</span>
              </button>
              <button
                type="button"
                onClick={handleEmptyCancel}
                aria-label="Cancel caption edit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-xs text-[var(--ink)] hover:bg-[var(--surface-strong)]"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingEmpty(true);
                setEmptyValue(segment.text);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] border border-dashed border-[var(--hairline-strong)] bg-[var(--canvas-soft)] px-2.5 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
            >
              <span className="text-[11px] opacity-60">＋</span> Click to add caption text…
            </button>
          )
        ) : (
          <p className="flex flex-wrap gap-1.5 leading-relaxed">
            {segment.words.map((w, idx) => {
              const low = isLowConfidence(w);
              const isEditingThis = editingWordIndex === idx;
              if (isEditingThis) {
              return (
                <span key={idx} className="inline-flex items-center" data-word>
                    <input
                      ref={inputRef}
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleWordConfirm();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleWordCancel();
                        }
                      }}
                      onBlur={() => {
                        // Confirm on blur unless empty escape? Schedule to allow Enter handler first
                        window.setTimeout(() => {
                          if (editingWordIndex === idx) {
                            // avoid double-confirm if already handled via Enter
                          }
                        }, 0);
                      }}
                      className="h-6 min-w-[40px] max-w-[160px] rounded-[6px] border border-[var(--primary)] bg-[var(--surface-card)] px-1.5 py-0 text-sm text-[var(--ink)] shadow-[0_0_0_3px_rgba(12,10,9,0.08)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                      style={{ width: `${Math.max(40, editingValue.length * 9 + 16)}px` }}
                      aria-label={`Edit word ${w.word}`}
                    />
                  </span>
                );
              }

              return (
                <span
                  key={idx}
                  data-word
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleWordClick(idx, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleWordClick(idx, e as unknown as React.MouseEvent);
                    }
                  }}
                  title={low ? "Low confidence — click to correct" : queryLower && w.word.toLowerCase().includes(queryLower) ? `Matches "${searchQuery}"` : "Click to edit"}
                  className={`inline-flex items-center rounded-[6px] px-1 py-0 text-sm leading-6 transition cursor-pointer select-none
                    ${low ? "border-b border-dashed border-[rgba(245,158,11,0.9)] bg-[rgba(245,158,11,0.10)] text-[var(--warning)] underline decoration-[var(--warning)] decoration-dotted underline-offset-[3px] hover:bg-[rgba(245,158,11,0.18)]" : "bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)] border border-transparent"}
                    ${queryLower && w.word.toLowerCase().includes(queryLower) ? "!bg-[rgba(245,158,11,0.22)] !text-[var(--warning)] ring-1 ring-[rgba(245,158,11,0.35)]" : ""}
                  `}
                >
                  <span className="pointer-events-none">{highlightMatch(w.word, searchQuery)}</span>
                </span>
              );
            })}
          </p>
        )}

        {/* Confidence meta row for screen readers / tooltip */}
        {segment.words.length > 0 && lowConf && (
          <p className="mt-1.5 text-[11px] leading-none text-[var(--warning)]/80">
            <span aria-hidden>·</span> Amber words are low confidence — click to correct
          </p>
        )}
      </div>

      {/* Hover action row — desktop CSS-only, mobile via long-press state — light hairline */}
      <div
        data-actions
        className={`mt-1 flex items-center gap-1.5 transition
          ${showMobileActions ? "flex" : "hidden group-hover:flex"}
          ${editingWordIndex !== null || isEditingTime || isEditingEmpty ? "!hidden" : ""}
        `}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSplit(segment.id);
          }}
          aria-label={`Split segment ${segment.text.slice(0, 24) || "at playhead"}`}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-2.5 text-xs font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)] hover:border-[var(--primary)]/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          title="Split at playhead (S)"
        >
          <span aria-hidden className="text-[11px]">✂</span> Split
        </button>
        <button
          type="button"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            if (!isLast) onMerge(segment.id);
          }}
          aria-label={isLast ? "Merge with next segment (disabled)" : "Merge with next segment"}
          className={`inline-flex h-7 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
            isLast
              ? "cursor-not-allowed border-[var(--hairline-soft)] bg-[var(--surface-card)]/60 text-[var(--muted)] opacity-50"
              : "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)] hover:border-[var(--primary)]/30"
          }`}
          title={isLast ? "No segment below to merge" : "Merge with next segment"}
        >
          <span aria-hidden className="text-[11px]">⤓</span> Merge ↓
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(segment.id);
          }}
          aria-label={`Delete segment ${segment.text.slice(0, 24) || segment.id.slice(0, 6)}`}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-2.5 text-xs font-medium text-[var(--semantic-error)] hover:bg-[rgba(220,38,38,0.12)] hover:border-[rgba(220,38,38,0.28)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--semantic-error)]"
          title="Delete segment (Del/Backspace)"
        >
          <span aria-hidden className="text-[11px]">✕</span> Delete
        </button>
        <span className="ml-auto hidden items-center gap-1 text-[10px] tracking-wide text-[var(--muted)] sm:inline-flex">
          {isActive && <span className="h-1 w-1 rounded-full bg-[var(--primary)] animate-pulse" />} {isActive ? "PLAYING" : ""}
        </span>
        {showMobileActions && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMobileActions(false);
            }}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-card)] text-xs text-[var(--muted)] sm:hidden"
            aria-label="Hide actions"
          >
            <span aria-hidden>✕</span>
          </button>
        )}
      </div>

      {/* Bottom subtle divider when not last — hairline-soft */}
      {!isLast && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--hairline-soft)] opacity-60 group-last:hidden" style={{ display: "none" }} />}
    </div>
  );
}
