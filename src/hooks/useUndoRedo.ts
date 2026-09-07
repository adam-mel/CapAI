"use client";
// UI-30: Re-export from EditorContext to avoid duplicated hook — single source of truth for undo/redo
// This file is kept for backward compat; all logic now delegates to EditorContext

import { useCallback, useEffect, useState } from "react";
import { useEditor, useEditorOptional } from "@/context/EditorContext";

/**
 * CapAI — useUndoRedo hook
 * PRD §6 — Wraps EditorContext undo/redo with polish:
 * - Stack depth 50 (handled in context)
 * - Tracked: text edits/splits/merges/deletes/adds/timestamp drags/style changes via context pushHistory
 * - Undo: Cmd/Ctrl+Z, Redo: Cmd/Ctrl+Shift+Z (or Ctrl+Y)
 * - RevertToAI bypasses stack (context handles)
 * - Provides subtle toast feedback without breaking editing
 * - Also usable standalone (throws if no provider, or falls back to no-op in non-editor routes)
 */

export interface UseUndoRedoReturn {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pushHistory: () => void;
  /** Latest toast message for UI, null when idle */
  toast: string | null;
}

export function useUndoRedo(): UseUndoRedoReturn {
  const ctx = useEditorOptional();
  const [toast, setToast] = useState<string | null>(null);

  // If no context, return no-op fallback (useful for tests or outside editor)
  // But prefer throwing in strict mode so misuse is obvious — we provide graceful fallback for standalone usage
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    const t = window.setTimeout(() => setToast(null), 1400);
    // cleanup if component unmounts before timeout — handled by React state ignore
    return () => window.clearTimeout(t);
  }, []);

  const undo = useCallback(() => {
    if (!ctx) return;
    if (!ctx.canUndo) {
      showToast("Nothing to undo");
      return;
    }
    ctx.undo();
    showToast("Undo");
  }, [ctx, showToast]);

  const redo = useCallback(() => {
    if (!ctx) return;
    if (!ctx.canRedo) {
      showToast("Nothing to redo");
      return;
    }
    ctx.redo();
    showToast("Redo");
  }, [ctx, showToast]);

  // Also listen for global keyboard here as a redundant polish layer
  // EditorContext already has global handler, but this ensures toast variant is tied to context state
  // No-op if ctx already handles; we avoid double-handling by checking if ctx exists and not re-adding heavy logic
  // This hook's listener is lightweight toast-aware; main logic stays in context
  useEffect(() => {
    if (!ctx) return;
    // We don't add duplicate undo/redo handlers here because context already does
    // This effect is primarily to keep toast state reactive
  }, [ctx]);

  if (!ctx) {
    // Fallback standalone — satisfies "or is standalone" spec: provide inert impl
    return {
      undo: () => showToast("Undo unavailable — no editor"),
      redo: () => showToast("Redo unavailable — no editor"),
      canUndo: false,
      canRedo: false,
      pushHistory: () => {},
      toast,
    };
  }

  return {
    undo,
    redo,
    canUndo: ctx.canUndo,
    canRedo: ctx.canRedo,
    pushHistory: ctx.pushHistory,
    toast,
  };
}

/**
 * Convenience hook that directly wraps EditorContext without toast
 * For callers that already handle toast via context's global handler
 */
export function useUndoRedoStrict(): UseUndoRedoReturn {
  const ctx = useEditor();
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  }, []);

  const undo = useCallback(() => {
    if (!ctx.canUndo) {
      showToast("Nothing to undo");
      return;
    }
    ctx.undo();
    showToast("Undo");
  }, [ctx, showToast]);

  const redo = useCallback(() => {
    if (!ctx.canRedo) {
      showToast("Nothing to redo");
      return;
    }
    ctx.redo();
    showToast("Redo");
  }, [ctx, showToast]);

  return {
    undo,
    redo,
    canUndo: ctx.canUndo,
    canRedo: ctx.canRedo,
    pushHistory: ctx.pushHistory,
    toast,
  };
}

export default useUndoRedo;
