"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { extractAudio } from "@/lib/ffmpeg";
import { transcribeWithFallback } from "@/lib/gemini";
import { initKeys } from "@/lib/geminiKeys";
import { groupWordsIntoSegments } from "@/lib/parseTranscription";
import { placeholderThumbnail } from "@/lib/thumbnail";
import type { Project, TranscriptionAttempt } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

type StepKey = "extract" | "transcribe" | "parse" | "building";

interface StepDef {
  key: StepKey;
  label: string;
}

const STEPS: StepDef[] = [
  { key: "extract", label: "Extracting audio track" },
  { key: "transcribe", label: "Sending audio to Gemini" },
  { key: "parse", label: "Parsing word timestamps" },
  { key: "building", label: "Building caption segments" },
];

type Status = StepKey | "error" | "done";

// ── Component ─────────────────────────────────────────────────────────────

export default function ProcessingClient({ projectId: propId }: { projectId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = propId ?? params?.id;

  const [project, setProject] = useState<Project | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("extract");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("extract");
  const cancelledRef = useRef(false);
  const retryCountRef = useRef(0);

  // New fallback states per spec
  const [attemptState, setAttemptState] = useState<{ idx: number; total: number; label: string } | null>(null);
  const [successfulKey, setSuccessfulKey] = useState<string | null>(null);
  const [attemptLog, setAttemptLog] = useState<TranscriptionAttempt[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load project + migrate legacy single-key storage
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await db.projects.get(id);
        if (!p) {
          if (!cancelled) setError("Project not found. It may have been deleted.");
          return;
        }
        if (!cancelled) {
          setProject(p);
          // Migrate legacy single-key -> multi-key store via initKeys
          try {
            initKeys();
          } catch (e) {
            console.warn("[ProcessingClient] initKeys migration failed", e);
            setAttemptLog([{ keyId: "migration", label: "Migration", status: "error", error: e instanceof Error ? e.message : String(e) } as unknown as TranscriptionAttempt]);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Auto-hide success banner after 5s
  useEffect(() => {
    if (!successfulKey) return;
    const t = window.setTimeout(() => setSuccessfulKey(null), 5000);
    return () => window.clearTimeout(t);
  }, [successfulKey]);

  const openSettings = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent("capai:open-settings", { detail: { source: "capai-internal", token: "capai-v1" } }));
    } catch {
      try {
        window.dispatchEvent(new Event("capai:open-settings"));
      } catch {}
    }
  }, []);

  const runPipeline = useCallback(async () => {
    const runId = id;
    if (!runId) return;
    cancelledRef.current = false;
    setError(null);
    setAttemptLog(null);
    setAttemptState(null);
    setSuccessfulKey(null);
    setStatus("extract");
    setActiveStep("extract");
    setProgress(2);

    let proj: Project | undefined;
    try {
      proj = await db.projects.get(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    }
    if (!proj) {
      setError("Project not found.");
      setStatus("error");
      return;
    }
    setProject(proj);

    // animateTo removed — dead code (UI-6) — progress is set directly per step
    void progressRef;

    let progInterval: ReturnType<typeof setInterval> | null = null;
    try {
      // ── 1) Extract (0-30%)
      setActiveStep("extract");
      setProgress(6);
      let audioB64: string;
      let mimeType: string;
      try {
        const blob = (proj.videoBlob as Blob | File) ?? null;
        if (!blob) throw new Error("No video data found");
        const res = await extractAudio(blob);
        if (cancelledRef.current) return;
        audioB64 = res.base64;
        mimeType = res.mimeType;
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }

      if (cancelledRef.current) return;
      setProgress(30);
      setActiveStep("transcribe");

      // Small visual pause so user sees check transition
      await new Promise((r) => setTimeout(r, 380));
      if (cancelledRef.current) return;

      // ── 2) Transcribe (30-70%)
      setActiveStep("transcribe");
      // Animate progress while transcribe is in flight — start slow creep
      let transcribeProgress = 32;
      progInterval = setInterval(() => {
        transcribeProgress = Math.min(68, transcribeProgress + 1.2);
        if (!cancelledRef.current) setProgress(Math.round(transcribeProgress));
      }, 420);

      // ── Multi-key fallback transcription ──
      // Ensure migration has run (initKeys is idempotent)
      try {
        initKeys();
      } catch (e) {
        console.warn("[runPipeline] initKeys failed", e);
      }

      abortRef.current = new AbortController();
      const abortSignal = abortRef.current.signal;

      let words;
      try {
        // Check abort mid-flight before calling
        if (cancelledRef.current || abortSignal.aborted) {
          clearInterval(progInterval);
          abortRef.current = null;
          return;
        }

        const result = await transcribeWithFallback(audioB64, mimeType, proj.settings.language, {
          onAttempt: ({ label }, idx, total) => setAttemptState({ idx: idx + 1, total, label }),
          signal: abortSignal,
        });

        words = result.words;
        // Keep attemptLog for success banner to compute retries
        setAttemptLog(result.attempts);
        setSuccessfulKey(result.successfulLabel);
        // Clear live attempt indicator
        setAttemptState(null);
      } catch (e: unknown) {
        clearInterval(progInterval);
        setAttemptState(null);
        abortRef.current = null;
        // If aborted, silently return without setting error
        if (
          cancelledRef.current ||
          (e instanceof DOMException && e.name === "AbortError") ||
          (e as Error)?.name === "AbortError" ||
          abortSignal.aborted
        ) {
          return;
        }
        throw e;
      }

      // Normal path: clear interval if not already cleared
      if (progInterval) { clearInterval(progInterval); progInterval = null; }
      setAttemptState(null);
      abortRef.current = null;

      if (cancelledRef.current) return;

      setProgress(70);
      setActiveStep("parse");

      await new Promise((r) => setTimeout(r, 260));
      if (cancelledRef.current) return;

      // ── 3) Parse (70-85%) — already done, just visual
      setProgress(82);
      await new Promise((r) => setTimeout(r, 320));
      if (cancelledRef.current) return;

      // ── 4) Building (85-100%)
      setActiveStep("building");
      setProgress(88);

      const segments = groupWordsIntoSegments(words!, proj.settings.wordsPerSegment);

      if (segments.length === 0) {
        throw new Error("No caption segments produced. Try a longer clip or different language.");
      }

      if (cancelledRef.current) return;
      setProgress(94);

      // Save to Dexie — deep clone for originalSegments
      const cloned = JSON.parse(JSON.stringify(segments)) as typeof segments;
      // Stale id guard — if user navigated a→b, don't overwrite b with a's result (UI-8)
      if (runId !== id || cancelledRef.current) return;
      const existing = await db.projects.get(runId);
      if (!existing) throw new Error("Project was deleted during processing.");
      await db.projects.put({
        ...existing,
        segments,
        originalSegments: cloned,
        updatedAt: Date.now(),
      });

      if (runId !== id || cancelledRef.current) return;
      setProgress(100);
      setStatus("done");
      setActiveStep("building");

      // Navigate after short success pause — keep banner visible during pause
      await new Promise((r) => setTimeout(r, 520));
      if (runId !== id || cancelledRef.current) return;
      router.push(`/projects/${runId}`);
    } catch (e) {
      if (progInterval) { clearInterval(progInterval); progInterval = null; }
      if (cancelledRef.current) return;
      // Clear live attempt UI
      setAttemptState(null);
      abortRef.current = null;

      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Capture per-key attempts for error card
      let attempts: TranscriptionAttempt[] | null = null;
      try {
        const maybe = e as unknown as Record<string, unknown>;
        if (maybe && typeof maybe === "object" && "attempts" in maybe && Array.isArray((maybe as { attempts?: unknown }).attempts)) {
          attempts = (maybe as { attempts: TranscriptionAttempt[] }).attempts;
        } else if (e instanceof AggregateError) {
          const agg = e as AggregateError & { attempts?: TranscriptionAttempt[] };
          if (Array.isArray(agg.attempts)) attempts = agg.attempts;
          else if (Array.isArray((agg as unknown as Record<string, unknown>).attempts as unknown[])) {
            attempts = (agg as unknown as Record<string, unknown>).attempts as TranscriptionAttempt[];
          }
        }
        // Also handle GeminiKeyError shape (has attempts)
        if (!attempts && maybe && Array.isArray((maybe as { attempts?: unknown[] }).attempts)) {
          attempts = (maybe as { attempts: TranscriptionAttempt[] }).attempts;
        }
      } catch {}
      if (attempts && attempts.length > 0) {
        setAttemptLog(attempts);
      } else {
        // Check if error message indicates no keys so UI still shows Open Settings
        setAttemptLog(null);
      }
      setStatus("error");
    }
  }, [id, router]);

  // Keep progressRef in sync for animate helper
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Auto-start on mount when project is loaded
  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (!project || hasStartedRef.current) return;
    hasStartedRef.current = true;
    // Defer to next tick so state is committed
    const t = setTimeout(() => {
      void runPipeline();
    }, 320);
    return () => clearTimeout(t);
  }, [project, runPipeline]);

  // On unmount or id change, cancel + abort signal (UI-8 stale id race)
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [id]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    try {
      abortRef.current?.abort();
    } catch {}
    setAttemptState(null);
    router.push("/");
  }, [router]);

  const handleRetry = useCallback(async () => {
    retryCountRef.current += 1;
    setError(null);
    setAttemptLog(null);
    setAttemptState(null);
    setSuccessfulKey(null);
    setStatus("extract");
    setProgress(0);
    setActiveStep("extract");
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = null;
    await runPipeline();
  }, [runPipeline]);

  const handleBack = useCallback(() => {
    cancelledRef.current = true;
    try {
      abortRef.current?.abort();
    } catch {}
    router.push("/");
  }, [router]);

  // Compute step index for rendering
  const activeIndex = STEPS.findIndex((s) => s.key === activeStep);
  const isError = status === "error";

  // Fallback thumbnail handling — graceful SVG fallback on broken JPEG
  const thumbUrl = project?.thumbnailDataUrl ?? null;
  const [thumbError, setThumbError] = useState(false);
  useEffect(() => {
    setThumbError(false);
  }, [thumbUrl]);

  // Derived success banner text: "Captioned with Key "Personal" (2 retries)"
  const successBannerText = (() => {
    if (!successfulKey || status === "error") return null;
    // If we have attemptLog and a successful key, retries = attempts.length -1
    if (attemptLog && attemptLog.length > 1) {
      const retries = attemptLog.length - 1;
      const retryLabel = retries === 1 ? "1 retry" : `${retries} retries`;
      return `Captioned with Key "${successfulKey}" (${retryLabel})`;
    }
    if (attemptLog && attemptLog.length === 1) {
      return `Captioned with Key "${successfulKey}"`;
    }
    return `Captioned with Key "${successfulKey}"`;
  })();

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)]">
      {/* Secondary bar — 48px, no duplicate wordmark (global SiteHeader owns CapAI) */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--hairline)] bg-[var(--canvas)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-strong)] text-[13px] leading-none text-[var(--ink)] transition hover:bg-[var(--surface-card)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            aria-label="Back to dashboard"
          >
            ←
          </Link>
          <span className="hidden h-4 w-px bg-[var(--hairline)] sm:inline-block" aria-hidden />
          <div className="min-w-0">
            {project ? (
              <span className="truncate text-sm font-[500] text-[var(--ink)] max-w-[28ch] sm:max-w-[36ch]" title={project.name}>
                {project.name.length > 36 ? project.name.slice(0, 36) + "…" : project.name}
              </span>
            ) : (
              <span className="text-[12px] font-[600] uppercase tracking-[0.96px] text-[var(--muted)]">Processing</span>
            )}
          </div>
        </div>
        {!isError ? (
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex h-8 items-center justify-center rounded-[9999px] border border-[var(--hairline-strong)] bg-transparent px-3.5 text-sm font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
          >
            Cancel
          </button>
        ) : null}
      </header>

      {/* Center stage — light canvas #f5f5f5 with surface-card xxl card + gradient orbs */}
      <main id="main-content" className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-12 bg-[var(--canvas)] relative overflow-hidden">
        {/* atmospheric orbs behind card — mint/peach/lavender */}
        <div className="pointer-events-none absolute -left-24 top-12 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.22)_0%,transparent_70%)] blur-[0.5px]" aria-hidden />
        <div className="pointer-events-none absolute -right-20 bottom-10 h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle_at_center,rgba(244,197,168,0.20)_0%,transparent_70%)] blur-[0.5px]" aria-hidden />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(200,184,224,0.16)_0%,transparent_70%)] blur-[0.5px]" aria-hidden />
        <div className="relative w-full max-w-[600px]">
          {/* Card — surface-card rounded xxl 24px with hairline */}
          <div className="relative overflow-hidden rounded-[var(--radius-xxl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-elevated)]">
            {/* subtle inner orbs inside card */}
            <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(167,229,211,0.14)_0%,transparent_70%)]" aria-hidden />
            <div className="pointer-events-none absolute -left-12 -bottom-12 h-32 w-32 rounded-full bg-[radial-gradient(circle_at_center,rgba(244,197,168,0.12)_0%,transparent_70%)]" aria-hidden />
            <div className="relative p-6 sm:p-8">
              {/* Thumbnail — blurred */}
              <div className="relative mx-auto w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline-soft)] bg-[var(--canvas-soft)]">
                {thumbUrl && !thumbError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt=""
                    aria-hidden="true"
                    className="h-[168px] w-full object-cover opacity-90 blur-[1.5px] scale-[1.02] sm:h-[196px]"
                    draggable={false}
                    onError={() => setThumbError(true)}
                  />
                ) : thumbUrl && thumbError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={placeholderThumbnail()}
                    alt=""
                    aria-hidden="true"
                    className="h-[168px] w-full object-cover opacity-90 blur-[1.5px] scale-[1.02] sm:h-[196px]"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-[168px] w-full items-center justify-center bg-[var(--surface-strong)] sm:h-[196px]">
                    <span className="text-2xl text-[var(--muted)]">✦</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--canvas)]/40 via-transparent to-transparent" aria-hidden />
                {/* Glass badge over thumbnail — light pill */}
                <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface-card)]/90 px-4 py-2 backdrop-blur-md shadow-[var(--shadow-soft)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--primary)]" aria-hidden />
                  <span className="hidden text-[11px] font-medium tracking-widest text-[var(--ink)] sm:block">PROCESSING</span>
                </div>
              </div>

              {/* Title — Waldenburg 300 */}
              <div className="mt-7 text-center">
                <h1 className="font-display text-[28px] font-[300] tracking-tight text-[var(--ink)] sm:text-[32px]" style={{ fontFamily: "var(--font-eb), 'EB Garamond', serif" }}>
                  {isError ? "We hit a snag" : status === "done" ? "Captions ready — opening editor…" : "Generating Captions..."}
                </h1>
                {!isError && status !== "done" && (
                  <p className="mt-2 text-sm text-[var(--muted)]">Usually takes 20–90s for long videos.</p>
                )}
              </div>

              {/* Success banner — shown for 5s after successful fallback */}
              {successfulKey && successBannerText && !isError ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-4 rounded-[12px] border border-[rgba(22,163,74,0.18)] bg-[rgba(22,163,74,0.08)] px-4 py-2.5 text-center text-sm font-[500] text-[var(--semantic-success)]"
                >
                  {successBannerText}
                </div>
              ) : null}

              {/* Steps OR Error */}
              {!isError ? (
                <>
                  {/* Steps list — hairline-soft dividers */}
                  <div className="mt-7 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)]">
                    {STEPS.map((step, idx) => {
                      let state: "done" | "active" | "pending";
                      if (status === "done") state = "done";
                      else if (idx < activeIndex) state = "done";
                      else if (idx === activeIndex) state = "active";
                      else state = "pending";

                      const isTranscribe = step.key === "transcribe";

                      return (
                        <div
                          key={step.key}
                          className={`flex flex-col gap-1 px-4 py-3.5 sm:px-5 ${idx !== STEPS.length - 1 ? "border-b border-[var(--hairline-soft)]" : ""} ${state === "active" ? "bg-[var(--surface-strong)]/60" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span
                                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] leading-none transition ${
                                  state === "done"
                                    ? "border-[var(--semantic-success)] bg-[rgba(22,163,74,0.10)] text-[var(--semantic-success)]"
                                    : state === "active"
                                      ? "border-[var(--primary)] bg-[var(--surface-card)] text-[var(--primary)]"
                                      : "border-[var(--hairline-strong)] bg-[var(--surface-strong)] text-[var(--muted)]"
                                }`}
                                aria-hidden
                              >
                                {state === "done" ? (
                                  "✓"
                                ) : state === "active" ? (
                                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--primary)]/30 border-t-[var(--primary)]" />
                                ) : (
                                  "○"
                                )}
                              </span>
                              <span
                                className={`text-sm ${state === "done" ? "font-[500] text-[var(--ink)]" : state === "active" ? "font-[500] text-[var(--ink)]" : "text-[var(--muted)]"}`}
                              >
                                {step.label}
                              </span>
                            </div>
                            <span
                              className={`shrink-0 text-xs font-medium tracking-wide ${state === "done" ? "text-[var(--semantic-success)]" : state === "active" ? "text-[var(--primary)]" : "text-[var(--muted)]"}`}
                            >
                              {state === "done" ? "Done" : state === "active" ? "In progress" : "—"}
                            </span>
                          </div>
                          {/* Live attempt indicator beneath "Sending audio to Gemini" */}
                          {isTranscribe && attemptState && state === "active" ? (
                            <div className="ml-10 flex items-center gap-1.5 text-xs text-[var(--muted)] animate-[fadeIn_160ms_ease-out]">
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--muted-soft)] border-t-[var(--primary)]" aria-hidden />
                              <span>
                                Trying key {attemptState.idx}/{attemptState.total} — {attemptState.label}…
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress bar — ink */}
                  <div className="mt-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)]">
                        <div
                          className="h-full rounded-full bg-[var(--primary)] transition-all duration-500 ease-out"
                          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                          role="progressbar"
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Generation progress"
                        />
                      </div>
                      <span className="min-w-[3ch] text-right font-mono text-xs font-[500] text-[var(--ink)]">{Math.round(progress)}%</span>
                    </div>
                    <p className="mt-2 text-center text-xs text-[var(--muted)]">
                      {progress < 30 ? "Warming up FFmpeg…" : progress < 70 ? "Talking to Gemini…" : progress < 95 ? "Assembling captions…" : "Finalizing…"}
                    </p>
                  </div>

                  {/* Cancel secondary below progress for mobile thumb zone */}
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="text-sm font-[500] text-[var(--ink)] underline decoration-[var(--hairline-strong)] underline-offset-4 transition hover:decoration-[var(--muted)]"
                    >
                      Cancel and go back
                    </button>
                  </div>
                </>
              ) : (
                /* Error state — light card with hairline + per-key log + Open Settings */
                <div className="mt-6 overflow-hidden rounded-[var(--radius-xl)] border border-[rgba(220,38,38,0.18)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]">
                  <div className="px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,0.08)] text-[16px] text-[var(--semantic-error)] border border-[rgba(220,38,38,0.18)]" aria-hidden>
                        ✕
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[16px] font-[500] text-[var(--ink)]">Gemini API Error</h2>
                        <p className="mt-1 text-sm leading-relaxed text-[var(--body)]">
                          Could not reach the Gemini API. Check your API key and try again.
                        </p>
                        <div className="mt-3 rounded-[8px] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.04)] px-3 py-2.5 text-xs leading-relaxed text-[var(--semantic-error)] break-words">
                          {error}
                        </div>
                        {/* Per-key log list when AggregateError with attempts */}
                        {attemptLog && attemptLog.length > 0 ? (
                          <div className="mt-3 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-strong)]/50 px-3 py-2.5">
                            <p className="text-xs font-[600] tracking-wide text-[var(--ink)]">Per-key attempts</p>
                            <ul className="mt-1.5 space-y-1">
                              {attemptLog.map((a, i) => {
                                const shortErr = (a.error ?? a.status ?? "unknown").toString().slice(0, 120);
                                const statusText = a.httpStatus ? `${a.httpStatus} ${shortErr}` : shortErr;
                                return (
                                  <li key={`${a.keyId}-${i}`} className="flex gap-1.5 text-xs leading-relaxed text-[var(--body)]">
                                    <span className="font-mono text-[var(--muted)]">Key {i + 1}</span>
                                    <span className="font-[500] text-[var(--ink)]">{a.label}:</span>
                                    <span className="break-words">{statusText}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
                      Keys are managed in Settings (stored locally, never sent to our servers). Add or reorder your Gemini keys and try again.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline-soft)] bg-[var(--surface-strong)]/30 px-5 py-4 sm:px-6">
                    <button
                      type="button"
                      onClick={handleBack}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-card)]"
                    >
                      ← Back
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openSettings}
                        className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-5 text-[15px] font-[500] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      >
                        Open Settings
                      </button>
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--primary-active)] active:scale-[0.98]"
                      >
                        Retry →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--hairline-soft)] bg-[var(--canvas)] px-6 py-3 text-center text-xs text-[var(--muted)]">
        CapAI · Local-first · No upload
      </footer>
    </div>
  );
}
