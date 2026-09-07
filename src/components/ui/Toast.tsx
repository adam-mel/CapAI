"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastVariant = "default" | "error";

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, variant = "default", onClose, duration = 3200 }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const innerTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Trigger enter animation
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setVisible(false);
      // allow exit animation before unmount — UI-27 fix: track inner timeout and clear on unmount
      innerTimeoutRef.current = window.setTimeout(() => onCloseRef.current(), 200) as unknown as number;
    }, duration);
    return () => {
      window.clearTimeout(t);
      if (innerTimeoutRef.current) window.clearTimeout(innerTimeoutRef.current);
    };
  }, [duration]);

  const handleClose = useCallback(() => {
    setVisible(false);
    if (innerTimeoutRef.current) window.clearTimeout(innerTimeoutRef.current);
    innerTimeoutRef.current = window.setTimeout(() => onCloseRef.current(), 180) as unknown as number;
  }, []);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`pointer-events-auto fixed bottom-6 left-1/2 z-[100] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-[var(--radius-xl)] border px-4 py-3 backdrop-blur-xl transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${
        variant === "error"
          ? "border-[rgba(220,38,38,0.18)] bg-[var(--surface-card)] text-[var(--ink)] shadow-[0_8px_32px_rgba(0,0,0,0.08),0_0_0_1px_var(--hairline)_inset]"
          : "border-[var(--hairline)] bg-[var(--surface-card)] text-[var(--ink)] shadow-[0_4px_16px_rgba(0,0,0,0.04),0_0_0_1px_var(--hairline)_inset]"
      }`}
      style={{
        boxShadow:
          variant === "error"
            ? "0 8px 32px rgba(0,0,0,0.08), 0 0 0 1px var(--hairline) inset"
            : "0 4px 16px rgba(0,0,0,0.04), 0 0 0 1px var(--hairline) inset",
      }}
    >
      {variant === "error" ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,0.08)] text-[var(--semantic-error)]">
          <span className="text-sm leading-none">!</span>
        </span>
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden />
      )}
      <p className="pr-1 text-sm font-medium leading-snug text-[var(--ink)]">{message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={handleClose}
        className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}
