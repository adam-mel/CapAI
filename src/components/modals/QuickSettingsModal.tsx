"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPendingFile, clearPendingFile } from "@/store/pendingUpload";
import { generateThumbnail, placeholderThumbnail } from "@/lib/thumbnail";
import { isRtlLanguage } from "@/lib/types";
import { getPresetStyle } from "@/lib/presets";
import { formatFileSize } from "@/lib/utils";
import { db } from "@/lib/db";
import type { PresetName } from "@/lib/types";

// ── Language & presets data ────────────────────────────────────────────

const LANGUAGE_OPTIONS: { code: string; label: string; native?: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
];

const WORDS_OPTIONS: (2 | 3 | 4 | 5)[] = [2, 3, 4, 5];

const PRESET_PREVIEWS: { name: PresetName; subtitle: string }[] = [
  { name: "Reels", subtitle: "Montserrat 900" },
  { name: "Clean", subtitle: "Inter · Pill" },
  { name: "Bold Drop", subtitle: "Impact · Gold" },
  { name: "Custom", subtitle: "Inter · Custom" },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDurationSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function fileLabel(name: string): string {
  if (name.length <= 28) return name;
  const ext = name.includes(".") ? "." + name.split(".").pop() : "";
  return name.slice(0, 24 - ext.length) + "…" + ext;
}

// ── Modal component ────────────────────────────────────────────────────

export default function QuickSettingsModal() {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [durationLoading, setDurationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Settings
  const [mode, setMode] = useState<"dynamic" | "static">("dynamic");
  const [language, setLanguage] = useState<string>("en");
  const [preset, setPreset] = useState<PresetName>("Reels");
  const [wordsPerSegment, setWordsPerSegment] = useState<2 | 3 | 4 | 5>(3);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Listen for dashboard event + check singleton on mount (race: event fired before listener)
  // BUG-AUTH-8: validate CustomEvent token to mitigate UI spoof; file detail validated via instanceof File / name check
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ file?: File; name?: string; source?: string; token?: string }>;
      // BUG-AUTH-8: require internal token for programmatic open; block spoofed events without token (isTrusted false)
      try {
        const hasValidToken = ce.detail?.source === "capai-internal" && ce.detail?.token === "capai-v1";
        if (!hasValidToken) {
          const isTrusted = (ce as unknown as { isTrusted?: boolean }).isTrusted;
          if (!isTrusted) {
            // Synthetic spoof without token — ignore, but allow fallback via getPendingFile singleton if file was set via setPendingFile memory
            const pending = getPendingFile();
            if (pending instanceof File) {
              setFile(pending);
              setIsOpen(true);
              setError(null);
            }
            return;
          }
        }
      } catch {}
      const incoming = (ce.detail?.file as File | undefined) ?? getPendingFile();
      if (incoming instanceof File) {
        // Validate file is a video type (extra guard)
        if (typeof incoming.name === "string" && typeof incoming.size === "number") {
          setFile(incoming);
          setIsOpen(true);
          setError(null);
        }
      } else if (ce.detail?.file) {
        // detail may be a File but not instanceof due to cross-realm?
        const f = ce.detail.file as File;
        if (f && typeof f.name === "string") {
          setFile(f);
          setIsOpen(true);
          setError(null);
        }
      }
    };

    window.addEventListener("capai:open-quick-settings", handler as EventListener);

    // If file was set before modal mounted (e.g., pendingUpload set synchronously then event already dispatched?)
    // Poll singleton shortly after mount.
    const pending = getPendingFile();
    if (pending) {
      // Only auto-open if no dialog already open and file looks valid
      // Defer a tick to allow event listener to fire first
      const t = window.setTimeout(() => {
        if (getPendingFile()) {
          setFile(getPendingFile());
          setIsOpen(true);
        }
      }, 50);
      return () => {
        window.removeEventListener("capai:open-quick-settings", handler as EventListener);
        window.clearTimeout(t);
      };
    }

    return () => window.removeEventListener("capai:open-quick-settings", handler as EventListener);
  }, []);

  // Derive duration from file via video metadata
  useEffect(() => {
    if (!file || !isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset duration when file closed
      setDurationSec(null);
      return;
    }
    let cancelled = false;
    setDurationLoading(true);

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    const onLoaded = () => {
      if (cancelled) {
        cleanup();
        return;
      }
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) setDurationSec(d);
      else setDurationSec(null);
      setDurationLoading(false);
      cleanup();
    };
    const onError = () => {
      if (!cancelled) {
        setDurationSec(null);
        setDurationLoading(false);
      }
      cleanup();
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    // Timeout fallback
    const t = window.setTimeout(() => {
      if (!cancelled) {
        setDurationLoading(false);
        cleanup();
      }
    }, 6000);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      cleanup();
    };
  }, [file, isOpen]);

  // UI-21: counter-based scroll lock — supports multiple modals
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

  // Focus trap-ish: focus dialog on open
  useEffect(() => {
    if (isOpen) {
      window.requestAnimationFrame(() => dialogRef.current?.focus());
    }
  }, [isOpen]);

  const close = useCallback(() => {
    if (isGenerating) return;
    setIsOpen(false);
    setError(null);
    clearPendingFile();
    window.setTimeout(() => {
      setFile(null);
      setDurationSec(null);
    }, 250);
  }, [isGenerating]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) close();
    },
    [close]
  );

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isGenerating) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isGenerating, close]);

  // Generate handler
  const handleGenerate = useCallback(async () => {
    if (!file) {
      setError("No video file selected.");
      return;
    }
    if (file.size === 0) {
      setError("File is empty.");
      return;
    }
    // Soft warning for huge files — do not block, just allow
    setError(null);
    setIsGenerating(true);

    try {
      // Generate thumbnail (best effort)
      let thumb: string;
      try {
        thumb = await generateThumbnail(file);
      } catch {
        thumb = placeholderThumbnail();
      }

      const captionStyle = getPresetStyle(preset);
      const rtl = isRtlLanguage(language);

      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);

      const now = Date.now();
      const project = {
        id,
        name: file.name,
        createdAt: now,
        updatedAt: now,
        videoBlob: file,
        thumbnailDataUrl: thumb,
        settings: {
          mode,
          language,
          wordsPerSegment,
          rtl,
        },
        captionStyle,
        segments: [],
        originalSegments: [],
      };

      // Persist to Dexie — use put to be safe across dexie versions
      await db.projects.put(project as never);

      try {
        localStorage.setItem("capai_last_project_id", id);
        localStorage.setItem("capai_last_language", language);
        window.dispatchEvent(new CustomEvent("capai:language-changed", { detail: { language } }));
      } catch {
        // ignore
      }

      // Keep pending file until navigation succeeds, then clear
      // Do not clear file state before navigation to avoid race
      setIsOpen(false);
      // Small delay for exit animation, then navigate
      window.setTimeout(() => {
        clearPendingFile();
        router.push(`/projects/${id}/processing`);
      }, 120);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to create project. Try again.");
      setIsGenerating(false);
    }
  }, [file, language, mode, preset, wordsPerSegment, router]);

  // Memoized file meta line
  const fileMeta = useMemo(() => {
    if (!file) return null;
    const size = formatFileSize(file.size);
    const dur = durationLoading ? "…" : durationSec != null ? formatDurationSeconds(durationSec) : "—";
    return { name: file.name, size, dur };
  }, [file, durationLoading, durationSec]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(12,10,9,0.28)] backdrop-blur-[12px] p-4 animate-[fadeIn_160ms_ease-out]"
      role="presentation"
      aria-hidden={false}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qs-title"
        className="relative flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[0_8px_32px_rgba(0,0,0,0.08),0_0_0_1px_var(--hairline)_inset] outline-none animate-[scaleIn_180ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient orbs — atmospheric decoration only, behind content */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
          <div className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-[var(--gradient-mint)] opacity-[0.32] blur-[50px]" />
          <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-[var(--gradient-peach)] opacity-[0.28] blur-[60px]" />
          <div className="absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--gradient-lavender)] opacity-[0.18] blur-[70px]" />
          <div className="absolute -bottom-10 right-1/4 h-44 w-44 rounded-full bg-[var(--gradient-sky)] opacity-[0.14] blur-[45px]" />
        </div>

        {/* Header — hairline border, off-white canvas context */}
        <div className="relative z-10 flex items-start justify-between gap-4 border-b border-[var(--hairline-soft)] bg-transparent px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="qs-title" className="flex items-center gap-2 text-[18px] font-[500] tracking-tight text-[var(--ink)]" style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)] text-[13px] text-[var(--ink)]">🎬</span>
              New Project
            </h2>
            {fileMeta ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="max-w-[220px] truncate font-[500] text-[var(--ink)]" title={fileMeta.name}>
                  {fileLabel(fileMeta.name)}
                </span>
                <span className="h-1 w-1 rounded-full bg-[var(--hairline-strong)]" aria-hidden />
                <span className="font-mono text-[var(--body)]">{fileMeta.dur}</span>
                <span className="h-1 w-1 rounded-full bg-[var(--hairline-strong)]" aria-hidden />
                <span className="text-[var(--body)]">{fileMeta.size}</span>
                {file && file.size > 2 * 1024 * 1024 * 1024 && (
                  <span className="ml-1 rounded-full border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.10)] px-2 py-0.5 text-[10px] font-medium text-[#b45309]">
                    &gt;2 GB — may be slow
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">No file selected</p>
            )}
          </div>

          <button
            type="button"
            aria-label="Close quick settings dialog"
            onClick={close}
            disabled={isGenerating}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-card)] text-[var(--muted)] shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        {/* Scrollable body — feature-card rhythm */}
        <div className="relative z-10 flex-1 overflow-y-auto bg-transparent px-6 py-6">
          {/* Caption Mode — pill buttons */}
          <div className="space-y-2.5">
            <label className="text-xs font-[500] tracking-wide text-[var(--muted)]">Caption Mode</label>
            <div className="flex gap-2">
              {(["dynamic", "static"] as const).map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    disabled={isGenerating}
                    aria-pressed={active}
                    aria-label={`Set caption mode to ${m}`}
                    className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[9999px] border px-5 text-[15px] font-[500] capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_2px_12px_rgba(12,10,9,0.08)]"
                        : "border-[var(--hairline-strong)] bg-transparent text-[var(--ink)] hover:bg-[var(--surface-card)] hover:border-[var(--hairline-strong)]"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${active ? "bg-[var(--on-primary)]" : "bg-[var(--hairline-strong)]"}`} aria-hidden />
                    {m}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              {mode === "dynamic" ? "Word-by-word highlight • karaoke style" : "Full segment at once • no animation"}
            </p>
          </div>

          {/* Language — text-input spec: 44px, rounded md, white, hairline-strong */}
          <div className="mt-6 space-y-2.5">
            <label htmlFor="qs-language" className="text-xs font-[500] tracking-wide text-[var(--muted)]">
              Transcription Language
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--muted)]" aria-hidden>
                🌐
              </span>
              <select
                id="qs-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isGenerating}
                className="h-11 w-full appearance-none rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] pl-10 pr-9 text-[15px] font-[400] tracking-[0.15px] text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] outline-none transition focus:border-[var(--ink)] focus:ring-2 focus:ring-[rgba(12,10,9,0.06)] disabled:opacity-60"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label} ({o.code})
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden>
                ▾
              </span>
            </div>
          </div>

          {/* Starting Style Preset — feature-card grid (xl rounded, white card, hairline) */}
          <div className="mt-6 space-y-3">
            <label className="text-xs font-[500] tracking-wide text-[var(--muted)]">Starting Style Preset</label>
            <div className="grid grid-cols-4 gap-2.5">
              {PRESET_PREVIEWS.map((p) => {
                const selected = preset === p.name;
                return (
                    <button
                    key={p.name}
                    type="button"
                    onClick={() => setPreset(p.name)}
                    disabled={isGenerating}
                    aria-pressed={selected}
                    aria-label={`Select preset ${p.name}`}
                    className={`group relative flex flex-col items-center gap-2 rounded-[16px] border bg-[var(--surface-card)] p-3 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60 ${
                      selected
                        ? "border-[var(--primary)] shadow-[0_0_0_3px_rgba(12,10,9,0.06),0_4px_16px_rgba(0,0,0,0.06)]"
                        : "border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:bg-[var(--canvas-soft)]"
                    }`}
                  >
                    {/* Mini preview box */}
                    <div
                      className={`flex h-[52px] w-full items-center justify-center rounded-[8px] border text-[13px] font-black leading-none transition ${
                        selected ? "bg-[#0f0f14] border-[var(--hairline)]" : "bg-[#0c0c11] border-[var(--hairline-soft)] group-hover:bg-[#10101a]"
                      }`}
                      aria-hidden
                    >
                      {p.name === "Reels" && (
                        <span className="text-white drop-shadow-[0_1px_0_#000] tracking-tight" style={{ fontFamily: "Montserrat, Inter, sans-serif", textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 0 #000" }}>
                          Aa
                        </span>
                      )}
                      {p.name === "Clean" && (
                        <span className="flex items-center justify-center rounded-full bg-[var(--surface-dark)] px-2 py-1 text-[11px] font-bold text-[var(--on-primary)]">Aa</span>
                      )}
                      {p.name === "Bold Drop" && (
                        <span className="text-[#FFD700] tracking-tight" style={{ fontFamily: "Impact, Anton, sans-serif", WebkitTextStroke: "0.7px #000", textShadow: "2px 2px 0 #000" }}>
                          Aa
                        </span>
                      )}
                      {p.name === "Custom" && (
                        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-dashed border-[var(--hairline-strong)] text-[16px] leading-none text-[var(--muted)]">+</span>
                      )}
                    </div>
                    <span className={`text-xs font-semibold leading-none ${selected ? "text-[var(--ink)]" : "text-[var(--body)]"}`}>{p.name}</span>
                    <span className="text-[10px] leading-none text-[var(--muted)] hidden sm:block">{p.subtitle}</span>
                    {selected && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-[9px] text-[var(--on-primary)]">✓</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--muted)]">Change anytime in the editor • Preset loads font, colors &amp; highlight</p>
          </div>

          {/* Words per segment — pill selectors */}
          <div className="mt-6 space-y-2.5">
            <label className="text-xs font-[500] tracking-wide text-[var(--muted)]">Words per Caption Segment</label>
            <div className="flex gap-2">
              {WORDS_OPTIONS.map((n) => {
                const active = wordsPerSegment === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setWordsPerSegment(n)}
                    disabled={isGenerating}
                    aria-pressed={active}
                    aria-label={`Set words per segment to ${n}`}
                    className={`inline-flex h-10 flex-1 items-center justify-center rounded-[9999px] border text-[15px] font-[500] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_2px_12px_rgba(12,10,9,0.08)]"
                        : "border-[var(--hairline-strong)] bg-transparent text-[var(--ink)] hover:bg-[var(--surface-card)]"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--muted)]">Default: 3 • Fewer words = punchier captions</p>
          </div>

          {/* Inline error — light editorial */}
          {error && (
            <div className="mt-5 flex gap-2.5 rounded-[12px] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3.5 py-3 text-sm leading-snug text-[var(--semantic-error)]" role="alert">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,0.10)] text-[11px]">!</span>
              <span className="flex-1 text-[13px] leading-snug">{error}</span>
            </div>
          )}
        </div>

        {/* Footer — hairline top, pill buttons */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-t border-[var(--hairline-soft)] bg-[var(--surface-card)] px-6 py-4">
          <button
            type="button"
            onClick={close}
            disabled={isGenerating}
            className="inline-flex h-10 items-center justify-center rounded-[9999px] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!file || isGenerating}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[0_2px_12px_rgba(12,10,9,0.08)] transition hover:bg-[var(--primary-active)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                Creating…
              </>
            ) : (
              <>
                <span aria-hidden>✦</span> Generate Captions →
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes scaleIn{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
    </div>
  );
}
