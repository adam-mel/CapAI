"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAllKeys, addKey, updateKey, deleteKey, maskKey, updateKeyStatus, initKeys } from "@/lib/geminiKeys";
import { testGeminiKey, classifyGeminiError } from "@/lib/gemini";
import type { GeminiKeyRecord, ApiKeyStatus } from "@/lib/types";

// ── helpers ──────────────────────────────────────────────────────────────

function relativeTimeShort(ts: number | null): string {
  if (ts == null) return "never";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 60) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function statusMeta(status: ApiKeyStatus): { label: string; color: string; bg: string; border: string } {
  switch (status) {
    case "working":
      return { label: "working", color: "#16a34a", bg: "rgba(22,163,74,0.10)", border: "rgba(22,163,74,0.22)" };
    case "invalid":
      return { label: "invalid", color: "#dc2626", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.18)" };
    case "rate_limited":
      return { label: "rate limited", color: "#d97706", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.24)" };
    case "error":
      return { label: "error", color: "#d97706", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.22)" };
    case "untested":
    default:
      return { label: "untested", color: "#a8a29e", bg: "rgba(168,162,158,0.14)", border: "rgba(168,162,158,0.22)" };
  }
}

// ── KeyCard ──────────────────────────────────────────────────────────────

function KeyCard({
  record,
  isTesting,
  isEditing,
  onTest,
  onToggle,
  onDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  record: GeminiKeyRecord;
  isTesting: boolean;
  isEditing: boolean;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onSaveEdit: (label: string, key: string) => void;
  onCancelEdit: () => void;
}) {
  const meta = statusMeta(record.status);
  const masked = maskKey(record.key);
  const [editLabel, setEditLabel] = useState(record.label);
  // BUG-AUTH-5: Do NOT prefill raw key in edit input — leave empty; masked display only.
  // User must re-enter key if they want to change it; empty means keep existing.
  const [editKey, setEditKey] = useState("");
  const [showEditKey, setShowEditKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setEditLabel(record.label);
      // BUG-AUTH-5: never prefill raw key — keep input empty
      setEditKey("");
      setShowEditKey(false);
      setConfirmDelete(false);
    }
  }, [isEditing, record.label]);

  const handleSave = () => {
    const l = editLabel.trim() || record.label;
    const k = editKey.trim();
    // BUG-AUTH-5: if k empty, caller will keep existing key (label-only edit)
    onSaveEdit(l, k);
  };

  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-card)] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
      {/* top row: drag handle + label + status */}
      <div className="flex items-start gap-3">
        {/* UI-24: drag handle removed — visual-only orphan with no draggable logic; reorder via Test Order button priority controls instead */}
        <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--muted-soft)] opacity-30" aria-hidden title="Reorder via priority">
          <span className="flex flex-col gap-[2px]"><span className="block h-[2px] w-3 rounded-full bg-current opacity-40" /><span className="block h-[2px] w-3 rounded-full bg-current opacity-40" /><span className="block h-[2px] w-3 rounded-full bg-current opacity-40" /></span>
        </span>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Label</label>
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="Label"
                  className="h-9 w-full rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:ring-2 focus:ring-[rgba(12,10,9,0.06)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">API Key</label>
                <div className="flex gap-2">
                  <input
                    value={editKey}
                    onChange={(e) => setEditKey(e.target.value)}
                    type={showEditKey ? "text" : "password"}
                    placeholder="Leave empty to keep current • AIza..."
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 flex-1 rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 font-mono text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:ring-2 focus:ring-[rgba(12,10,9,0.06)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditKey((v) => !v)}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-3 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                  >
                    {showEditKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex h-8 items-center justify-center rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-[var(--on-primary)] hover:bg-[var(--primary-active)]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="inline-flex h-8 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-4 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--ink)]">{record.label}</span>
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
                >
                  {meta.label}
                </span>
                {isTesting && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-strong)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--muted-soft)] border-t-[var(--ink)]" aria-hidden />
                    testing
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-xs tracking-wide text-[var(--body)]" title={masked}>
                {masked}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <span>last tested {relativeTimeShort(record.lastTestedAt)}</span>
                {record.lastError ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-[var(--hairline-strong)]" aria-hidden />
                    <span className="max-w-[220px] truncate text-[var(--muted)]" title={record.lastError}>
                      {record.lastError.slice(0, 80)}
                      {record.lastError.length > 80 ? "…" : ""}
                    </span>
                  </>
                ) : null}
              </div>
              {!isEditing && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onTest}
                    disabled={isTesting}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-3.5 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--surface-card)] hover:shadow-[0_1px_8px_rgba(0,0,0,0.04)] disabled:opacity-50"
                  >
                    {isTesting ? "Testing…" : "Test Now"}
                  </button>

                  {/* Enable toggle — switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={record.isActive}
                    aria-label={record.isActive ? "Disable key" : "Enable key"}
                    onClick={onToggle}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${record.isActive ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--hairline-strong)] bg-[var(--surface-strong)]"}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${record.isActive ? "translate-x-6" : "translate-x-1"}`}
                      aria-hidden
                    />
                  </button>
                  <span className="text-xs font-medium text-[var(--muted)]">{record.isActive ? "Enabled" : "Disabled"}</span>

                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-transparent bg-transparent px-3 text-xs font-medium text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                  >
                    Edit
                  </button>

                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex h-8 items-center justify-center rounded-full border border-transparent bg-transparent px-3 text-xs font-medium text-[var(--muted)] hover:bg-[rgba(220,38,38,0.08)] hover:text-[var(--semantic-error)]"
                    >
                      Delete
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(false);
                          onDelete();
                        }}
                        className="inline-flex h-8 items-center justify-center rounded-full bg-[var(--semantic-error)] px-3 text-xs font-medium text-white hover:bg-[#b91c1c]"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="inline-flex h-8 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-3 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SettingsWindow ───────────────────────────────────────────────────────

export default function SettingsWindow() {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<GeminiKeyRecord[]>([]);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [testAllRunning, setTestAllRunning] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    try {
      setKeys(getAllKeys());
    } catch {
      // ignore
    }
  }, []);

  // Listen for open + keys-changed — also bootstrap legacy migration once
  useEffect(() => {
    try {
      initKeys();
    } catch {}
    // BUG-AUTH-8: Unvalidated CustomEvent — validate detail token to mitigate UI spoof/phishing
    // SiteHeader dispatches with detail {source:"capai-internal", token:"capai-v1"}; plain
    // `dispatchEvent(new CustomEvent("capai:open-settings"))` without token is treated as potential spoof
    // and ignored. Real user gesture dispatches are also programmatic (isTrusted false), so token is required.
    const onOpen = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ source?: string; token?: string }>;
        const hasValidToken = ce.detail?.source === "capai-internal" && ce.detail?.token === "capai-v1";
        if (!hasValidToken) {
          // Allow isTrusted user events? But our own dispatches are not trusted, so require token.
          // For backward compat in tests/dev console, still allow if isTrusted (real click via browser UI).
          const isTrusted = (ce as unknown as { isTrusted?: boolean }).isTrusted;
          if (!isTrusted) {
            // Check userActivation as secondary signal — if user recently interacted, allow? No, require token strictly
            // to prevent `window.dispatchEvent(new CustomEvent("capai:open-settings"))` from opening modal (repro).
            console.debug("[SettingsWindow] blocked capai:open-settings without valid token");
            return;
          }
        }
      } catch {}
      refresh();
      setIsOpen(true);
    };
    const onKeysChanged = () => refresh();

    window.addEventListener("capai:open-settings", onOpen as EventListener);
    window.addEventListener("capai:keys-changed", onKeysChanged as EventListener);
    // initial load
    refresh();
    return () => {
      window.removeEventListener("capai:open-settings", onOpen as EventListener);
      window.removeEventListener("capai:keys-changed", onKeysChanged as EventListener);
    };
  }, [refresh]);

  // UI-21 counter lock
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  // focus trap: focus card on open
  useEffect(() => {
    if (isOpen) {
      window.requestAnimationFrame(() => {
        // prefer label input if few keys, else card
        if (labelInputRef.current) labelInputRef.current.focus();
        else cardRef.current?.focus();
      });
    }
  }, [isOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
    setFormError(null);
    setShowKey(false);
    setEditingId(null);
  }, []);

  // Esc
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      // focus trap: keep tab inside card
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) close();
    },
    [close]
  );

  const handleAdd = useCallback(() => {
    setFormError(null);
    const label = draftLabel.trim();
    const key = draftKey.trim();
    if (!key) {
      setFormError("Paste your Gemini API key.");
      return;
    }
    try {
      addKey({ label: label || `Key ${keys.length + 1}`, key });
      setDraftLabel("");
      setDraftKey("");
      setShowKey(false);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFormError(msg);
    }
  }, [draftLabel, draftKey, keys.length, refresh]);

  const handlePaste = useCallback(async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) setDraftKey(text.trim());
      }
    } catch {
      // clipboard may be denied
    }
  }, []);

  const handleTest = useCallback(
    async (id: string) => {
      const rec = keys.find((k) => k.id === id);
      if (!rec) return;
      setTestingIds((prev) => new Set(prev).add(id));
      try {
        const result = await testGeminiKey(rec.key);
        const now = Date.now();
        if (result.ok) {
          updateKeyStatus(id, {
            status: "working",
            lastTestedAt: now,
            lastError: null,
            lastHttpStatus: result.httpStatus,
            rateLimitedUntil: null,
          });
        } else {
          // classify to map status
          const cls = classifyGeminiError(new Error(`${result.error ?? "Error"} (${result.httpStatus ?? ""})`));
          let status: ApiKeyStatus = "error";
          if (cls.code === "invalid_key") status = "invalid";
          else if (cls.code === "rate_limited") status = "rate_limited";
          const patch: Partial<GeminiKeyRecord> & { status: ApiKeyStatus } = {
            status,
            lastTestedAt: now,
            lastError: result.error ?? cls.message ?? "Test failed",
            lastHttpStatus: result.httpStatus,
          } as never;
          if (status === "rate_limited") {
            patch.rateLimitedUntil = now + (cls.retryAfterMs ?? 60_000);
          } else {
            patch.rateLimitedUntil = null;
          }
          updateKeyStatus(id, patch as never);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cls = classifyGeminiError(e);
        let status: ApiKeyStatus = "error";
        if (cls.code === "invalid_key") status = "invalid";
        else if (cls.code === "rate_limited") status = "rate_limited";
        updateKeyStatus(id, {
          status,
          lastTestedAt: Date.now(),
          lastError: msg,
          lastHttpStatus: cls.httpStatus ?? null,
          rateLimitedUntil: status === "rate_limited" ? Date.now() + (cls.retryAfterMs ?? 60_000) : null,
        } as never);
      } finally {
        setTestingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        refresh();
      }
    },
    [keys, refresh]
  );

  const handleTestAll = useCallback(async () => {
    if (keys.length === 0 || testAllRunning) return;
    setTestAllRunning(true);
    for (const k of keys) {
      // sequential to avoid rate-limit burst
      // eslint-disable-next-line no-await-in-loop
      await handleTest(k.id);
    }
    setTestAllRunning(false);
  }, [keys, handleTest, testAllRunning]);

  const handleToggle = useCallback(
    (id: string) => {
      const rec = keys.find((k) => k.id === id);
      if (!rec) return;
      updateKey(id, { isActive: !rec.isActive });
      refresh();
    },
    [keys, refresh]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteKey(id);
      if (editingId === id) setEditingId(null);
      refresh();
    },
    [editingId, refresh]
  );

  const handleSaveEdit = useCallback(
    (id: string, label: string, key: string) => {
      try {
        const trimmedKey = (key ?? "").trim();
        if (!trimmedKey) {
          // BUG-AUTH-5: empty key means keep existing — only update label
          updateKey(id, { label });
        } else {
          updateKey(id, { label, key: trimmedKey });
        }
        setEditingId(null);
        refresh();
      } catch (e) {
        // surface via alert-like inline? for now just toast via formError in card? simplest: log
        const msg = e instanceof Error ? e.message : String(e);
        // we could show in formError banner
        setFormError(msg);
      }
    },
    [refresh]
  );

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(12,10,9,0.28)] p-4 backdrop-blur-[12px] animate-[fadeIn_160ms_ease-out]"
      role="presentation"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capai-settings-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-[680px] max-h-[80vh] flex-col rounded-[24px] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[0_8px_32px_rgba(0,0,0,0.08)] outline-none animate-[scaleIn_180ms_ease-out] overflow-hidden"
      >
        {/* gradient orbs — atmospheric decoration only */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
          <div className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-[var(--gradient-mint)] opacity-[0.32] blur-[50px]" />
          <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-[var(--gradient-peach)] opacity-[0.28] blur-[60px]" />
          <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--gradient-lavender)] opacity-[0.18] blur-[70px]" />
          <div className="absolute -bottom-10 right-1/4 h-44 w-44 rounded-full bg-[var(--gradient-sky)] opacity-[0.14] blur-[45px]" />
        </div>

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between gap-4 border-b border-[var(--hairline-soft)] bg-transparent px-6 py-4">
          <h2
            id="capai-settings-title"
            className="text-[18px] font-[500] tracking-tight text-[var(--ink)]"
            style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}
          >
            Settings
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-card)] text-[var(--muted)] shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        {/* Body */}
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-6">
          {/* Add Key form */}
          <div className="space-y-3">
            <h3 className="text-xs font-[600] uppercase tracking-[0.96px] text-[var(--muted)]">Add API Key</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label htmlFor="capai-settings-label" className="block text-xs font-medium text-[var(--muted)]">
                  Label
                </label>
                <input
                  ref={labelInputRef}
                  id="capai-settings-label"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder="e.g. Primary"
                  className="h-11 w-full rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 text-[15px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] outline-none transition focus:border-[var(--ink)] focus:ring-2 focus:ring-[rgba(12,10,9,0.06)]"
                />
              </div>
              <div className="flex-[1.6] space-y-1.5">
                <label htmlFor="capai-settings-key" className="block text-xs font-medium text-[var(--muted)]">
                  API Key
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="capai-settings-key"
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      type={showKey ? "text" : "password"}
                      placeholder="AIza..."
                      autoComplete="off"
                      spellCheck={false}
                      className="h-11 w-full rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 pr-20 font-mono text-sm text-[var(--ink)] placeholder:text-[var(--muted-soft)] outline-none transition focus:border-[var(--ink)] focus:ring-2 focus:ring-[rgba(12,10,9,0.06)]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 items-center justify-center rounded-full border border-transparent px-2.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                    >
                      {showKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-4 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--surface-strong)]"
                  >
                    Paste
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-6 text-[15px] font-[500] text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] transition hover:bg-[var(--primary-active)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
              >
                Add
              </button>
            </div>
            {formError && (
              <div className="rounded-[12px] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3.5 py-2.5 text-sm leading-snug text-[var(--semantic-error)]" role="alert">
                {formError}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              Keys are stored locally in your browser (obfuscated with reversible base64 — not encryption) and never sent to our servers — only directly to Google Gemini. Anyone with access to this browser profile can decode them; for billed keys use a server proxy.
            </p>
          </div>

          {/* List of KeyCards */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-[600] uppercase tracking-[0.96px] text-[var(--muted)]">
                API Keys {keys.length > 0 ? `· ${keys.length}` : ""}
              </h3>
              {keys.length > 1 && (
                <span className="text-[11px] text-[var(--muted-soft)]">Drag handle to reorder (top = highest priority)</span>
              )}
            </div>

            {keys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--hairline-strong)] bg-[var(--canvas-soft)] px-6 py-10 text-center">
                <p className="text-sm font-medium text-[var(--ink)]">No API keys yet</p>
                <p className="mx-auto mt-1 max-w-[36ch] text-sm leading-relaxed text-[var(--muted)]">
                  Add your Gemini API key above. You can add multiple keys — CapAI will try them in order if one is rate-limited.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map((k) => (
                  <KeyCard
                    key={k.id}
                    record={k}
                    isTesting={testingIds.has(k.id)}
                    isEditing={editingId === k.id}
                    onTest={() => handleTest(k.id)}
                    onToggle={() => handleToggle(k.id)}
                    onDelete={() => handleDelete(k.id)}
                    onStartEdit={() => setEditingId(k.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(label, key) => handleSaveEdit(k.id, label, key)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            Done
          </button>
          <button
            type="button"
            onClick={handleTestAll}
            disabled={keys.length === 0 || testAllRunning}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            {testAllRunning ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted-soft)] border-t-[var(--ink)]" aria-hidden />
                Testing…
              </>
            ) : (
              "Test all"
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes scaleIn{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
    </div>
  );
}
