"use client";

import { useCallback } from "react";
import { useEditor } from "@/context/EditorContext";

/**
 * CapAI — Caption Operations Hook
 * PRD §5.4 — Split / Merge / Delete / Add Blank + undo-aware mutations
 *
 * Thin wrapper around EditorContext so CaptionList / CaptionRow remain
 * decoupled and testable. All mutations push to the undo stack before
 * applying, per spec.
 */
export interface UseCaptionOperationsReturn {
  splitSegment: (id: string) => boolean;
  mergeSegment: (id: string) => boolean;
  deleteSegment: (id: string) => void;
  addSegment: () => string | null;
  updateSegmentText: (id: string, newText: string) => void;
  updateSegmentWords: (id: string, words: import("@/lib/types").WordToken[]) => void;
  updateSegmentTiming: (id: string, startMs: number, endMs: number) => void;
  copySegmentText: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCaptionOperations(): UseCaptionOperationsReturn {
  const ctx = useEditor();

  const splitSegment = useCallback(
    (id: string) => ctx.splitSegment(id),
    [ctx]
  );

  const mergeSegment = useCallback(
    (id: string) => ctx.mergeSegment(id),
    [ctx]
  );

  const deleteSegment = useCallback(
    (id: string) => ctx.deleteSegment(id),
    [ctx]
  );

  const addSegment = useCallback(() => ctx.addSegment(), [ctx]);

  const updateSegmentText = useCallback(
    (id: string, newText: string) => {
      const seg = ctx.segments.find((s) => s.id === id);
      if (!seg) return;
      // Simple rebuild: split newText into words keeping timings roughly proportional?
      // Per spec for word click editing: update words[clickedIndex].word and recompute text as words.join(' ')
      // For full-text updates (e.g., pasted), we rebuild words with interpolated timings.
      const rawWords = newText.trim() ? newText.trim().split(/\s+/) : [];
      if (seg.words.length === 0 && rawWords.length > 0) {
        // Blank segment: distribute timings across duration
        const dur = Math.max(1, seg.endMs - seg.startMs);
        const slice = dur / rawWords.length;
        const words = rawWords.map((w, i) => ({
          word: w,
          startMs: Math.round(seg.startMs + i * slice),
          endMs: Math.round(seg.startMs + (i + 1) * slice),
          confidence: 1,
        }));
        ctx.updateSegment(id, { text: newText.trim(), words });
      } else {
        // Keep words length alignment if possible: update words text where count matches, else rebuild vocab tail
        // For now, just update text and try to keep timings if word count same, else rebuild with preserved timings trimmed/padded
        if (rawWords.length === seg.words.length) {
          const words = seg.words.map((wt, i) => ({ ...wt, word: rawWords[i] }));
          ctx.updateSegment(id, { text: rawWords.join(" "), words });
        } else if (rawWords.length > 0) {
          // Rebuild: when word count changes, redistribute ALL words uniformly to avoid tail overlap
          const dur = Math.max(1, seg.endMs - seg.startMs);
          const slice = dur / rawWords.length;
          const words = rawWords.map((w, i) => ({
            word: w,
            startMs: Math.round(seg.startMs + i * slice),
            endMs: Math.round(seg.startMs + (i + 1) * slice),
            confidence: seg.words[i]?.confidence ?? 1,
          }));
          // Recompute segment timing from words extremes
          const startMs = words[0]?.startMs ?? seg.startMs;
          const endMs = words[words.length - 1]?.endMs ?? seg.endMs;
          ctx.updateSegment(id, { text: rawWords.join(" "), words, startMs, endMs });
        } else {
          ctx.updateSegment(id, { text: "", words: [] });
        }
      }
    },
    [ctx]
  );

  const updateSegmentWords = useCallback(
    (id: string, words: import("@/lib/types").WordToken[]) => {
      const text = words.map((w) => w.word).join(" ");
      const confidences = words.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
      const startMs = words.length > 0 ? words[0].startMs : undefined;
      const endMs = words.length > 0 ? words[words.length - 1].endMs : undefined;
      ctx.updateSegment(id, {
        text,
        words: words.map((w) => ({ ...w })),
        confidence: confidences.length ? Math.min(...confidences) : undefined,
        ...(startMs !== undefined ? { startMs } : {}),
        ...(endMs !== undefined ? { endMs } : {}),
      });
    },
    [ctx]
  );

  const updateSegmentTiming = useCallback(
    (id: string, startMs: number, endMs: number) => {
      // Also synced to waveform via context — emit is implicit via segments change
      ctx.updateSegment(id, { startMs, endMs });
    },
    [ctx]
  );

  const copySegmentText = useCallback(
    (id: string) => ctx.copySegmentText(id),
    [ctx]
  );

  return {
    splitSegment,
    mergeSegment,
    deleteSegment,
    addSegment,
    updateSegmentText,
    updateSegmentWords,
    updateSegmentTiming,
    copySegmentText,
    undo: ctx.undo,
    redo: ctx.redo,
    canUndo: ctx.canUndo,
    canRedo: ctx.canRedo,
  };
}

export default useCaptionOperations;
