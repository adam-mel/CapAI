// © 2026 CapAI — All Rights Reserved. Viewing only.
/**
 * CapAI — Gemini 2.5 Flash transcription
 * PRD §11 — POST audio base64 to Gemini and parse WordToken[]
 * Extended with multi-key fallback: classifyGeminiError, testGeminiKey, transcribeWithFallback
 *
 * SECURITY NOTES (BUG-AUTH-2, BUG-AUTH-6):
 * - BUG-AUTH-2: Google Generative Language API documents `?key=` query param. This leaks to
 *   browser history (via performance entries), Referer header, proxy logs, and extension
 *   webRequest. Mitigated by `Referrer-Policy: no-referrer` (next.config.ts) and CSP.
 *   Alternative header `x-goog-api-key` keeps key out of URL where supported; we keep
 *   query param for compatibility but document header alternative below. Ideal fix is
 *   server-side proxy: browser POSTs audio to /api/gemini/transcribe with key in
 *   HttpOnly session, server injects ?key= server-to-server.
 * - BUG-AUTH-6: Direct browser→Google fetch is interceptable via `window.fetch` monkey-
 *   patch or extension `webRequest`. No client-side cert pinning is possible. Mitigated
 *   by CSP `connect-src 'self' https://generativelanguage.googleapis.com` (blocks exfil
 *   to attacker domains, though extensions bypass CSP). Future: proxy via server.
 */

import type { WordToken, TranscriptionAttempt, TranscriptionResultWithMeta, ApiKeyStatus } from "./types";
import { getEnabledKeysSorted, updateKeyStatus } from "./geminiKeys";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  he: "Hebrew",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  it: "Italian",
  ru: "Russian",
};

function languageLabel(code: string): string {
  const lower = code.toLowerCase();
  return LANGUAGE_NAMES[lower] ?? code;
}

function buildPrompt(language: string): string {
  const langName = languageLabel(language);
  return `You are a professional video captioning assistant.
Transcribe the audio and return ONLY a JSON array. No markdown, no explanation.

Each object must have:
{
  "startMs": number,     // word start time in milliseconds
  "endMs": number,       // word end time in milliseconds
  "word": string,        // the spoken word
  "confidence": number   // 0.0 to 1.0
}

Language: ${langName} (${language})
Return ONLY valid JSON array. Example:
[{"startMs":0,"endMs":320,"word":"Hello","confidence":0.99},{"startMs":320,"endMs":600,"word":"world","confidence":0.98}]`;
}

// ── GeminiKeyError ─────────────────────────────────────────────────────────

export class GeminiKeyError extends Error {
  httpStatus: number | null;
  code: string;
  retryAfterMs: number | null;
  noRetry?: boolean;
  attempts?: TranscriptionAttempt[];

  constructor(
    message: string,
    httpStatus: number | null = null,
    code: string = "transient",
    attempts?: TranscriptionAttempt[],
    retryAfterMs: number | null = null,
    noRetry?: boolean
  ) {
    super(message);
    this.name = "GeminiKeyError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.attempts = attempts;
    this.retryAfterMs = retryAfterMs;
    this.noRetry = noRetry;
    // Ensure proper prototype chain
    Object.setPrototypeOf(this, GeminiKeyError.prototype);
  }
}

// ── Error classification ─────────────────────────────────────────────────

export interface GeminiErrorClassification {
  code: "invalid_key" | "rate_limited" | "transient" | "network";
  httpStatus: number | null;
  retryAfterMs: number | null;
  message: string;
  noRetry?: boolean;
}

function parseRetryDelayMs(value: string): number | null {
  if (!value) return null;
  const m = value.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (!Number.isNaN(n) && Number.isFinite(n)) return Math.round(n * 1000);
  }
  const n = parseFloat(value);
  if (!Number.isNaN(n) && Number.isFinite(n) && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.round(n * 1000);
  }
  return null;
}

function parseRetryAfterHeader(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Numeric seconds — allow fractional via parseFloat
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const n = parseFloat(trimmed);
    if (!Number.isNaN(n) && Number.isFinite(n)) return Math.round(n * 1000);
  }
  // e.g. "34s" or "34.5s"
  const sMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (sMatch) {
    const n = parseFloat(sMatch[1]);
    if (!Number.isNaN(n)) return Math.round(n * 1000);
  }
  // Plain float seconds (redundant but keep)
  const asFloat = parseFloat(trimmed);
  if (!Number.isNaN(asFloat) && isFinite(asFloat) && String(asFloat) === trimmed) {
    return Math.round(asFloat * 1000);
  }
  // HTTP date — return diff even if >24h, clamp to 24h max (avoid 60s hammer for 25h Retry-After)
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const diff = parsed - Date.now();
    if (diff > 0) return Math.min(diff, 24 * 3600 * 1000);
  }
  return null;
}

/**
 * Classify a Gemini error (Response or thrown Error) into a structured code.
 *  - 401/403 → invalid_key
 *  - 429 → rate_limited (parses Retry-After header or body retryDelay)
 *  - 400 → transient with noRetry (should NOT rotate)
 *  - 5xx / network → transient / network
 * Also handles message strings like "API key error", "quota exceeded".
 */
export function classifyGeminiError(input: unknown): GeminiErrorClassification {
  // ── Response duck-type ──
  if (
    input != null &&
    typeof input === "object" &&
    "status" in (input as Record<string, unknown>) &&
    "headers" in (input as Record<string, unknown>)
  ) {
    const res = input as Response;
    const status = (res as Response).status;
    let retryAfterMs: number | null = null;
    try {
      const h = (res.headers as Headers)?.get?.("Retry-After") ?? (res.headers as Headers)?.get?.("retry-after") ?? null;
      if (h) retryAfterMs = parseRetryAfterHeader(h);
    } catch {}
    const msg = (res as Response).statusText || `HTTP ${status}`;
    if (status === 401 || status === 403) {
      return { code: "invalid_key", httpStatus: status, retryAfterMs, message: msg };
    }
    if (status === 429) {
      return { code: "rate_limited", httpStatus: status, retryAfterMs: retryAfterMs ?? 60_000, message: msg };
    }
    if (status === 400) {
      return { code: "transient", httpStatus: status, retryAfterMs: null, message: msg, noRetry: true };
    }
    if (status >= 500 && status < 600) {
      return { code: "transient", httpStatus: status, retryAfterMs, message: msg };
    }
    // Check for network-like status? fetch would not give Response for network errors
    if (status >= 400) {
      return { code: "transient", httpStatus: status, retryAfterMs, message: msg };
    }
    return { code: "transient", httpStatus: status, retryAfterMs, message: msg };
  }

  // ── Error / string / unknown ──
  const rawMsg: string =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : input != null && typeof (input as unknown as Record<string, unknown>).message === "string"
          ? String((input as unknown as Record<string, unknown>).message)
          : String(input ?? "");

  const lower = rawMsg.toLowerCase();

  // Extract httpStatus from message if present
  let httpStatus: number | null = null;
  const statusMatch = rawMsg.match(/\b(400|401|403|408|429|500|501|502|503|504)\b/);
  if (statusMatch) httpStatus = parseInt(statusMatch[1], 10);

  // Extract retryDelay from message body e.g. retryDelay: "34s" or "60s"
  let retryAfterMs: number | null = null;
  // Look for retryDelay pattern first (from Gemini body details)
  const retryDelayMatch =
    rawMsg.match(/retryDelay\s*[:=]\s*["']?\s*(\d+(?:\.\d+)?)\s*s/i) ||
    rawMsg.match(/retry[-\s]*delay\s*[:=]?\s*(\d+(?:\.\d+)?)\s*s/i) ||
    rawMsg.match(/retry[-\s]*after\s*[:=]?\s*["']?\s*(\d+(?:\.\d+)?)\s*s?/i);
  if (retryDelayMatch) {
    const secs = parseFloat(retryDelayMatch[1]);
    if (!Number.isNaN(secs)) retryAfterMs = Math.round(secs * 1000);
  } else {
    // Try Retry-After numeric in message
    const retryAfterMsg = rawMsg.match(/retry-after\s*[:=]\s*(\d+)/i);
    if (retryAfterMsg) retryAfterMs = parseInt(retryAfterMsg[1], 10) * 1000;
  }

  // If input has retryAfterMs property directly (e.g. enriched object)
  if (input != null && typeof input === "object" && "retryAfterMs" in (input as Record<string, unknown>)) {
    const v = (input as Record<string, unknown>).retryAfterMs;
    if (typeof v === "number" && Number.isFinite(v)) retryAfterMs = v;
  }

  // 401/403 invalid_key
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: "invalid_key", httpStatus, retryAfterMs: null, message: rawMsg };
  }
  if (lower.includes("api key error") || lower.includes("api_key") || lower.includes("api key is invalid") || lower.includes("api key not valid")) {
    // Ensure not quota case masquerading as api key error
    if (lower.includes("quota exceeded") || lower.includes("rate limit") || lower.includes("resource_exhausted") || httpStatus === 429) {
      // fall through to rate_limited check below
    } else {
      return { code: "invalid_key", httpStatus: httpStatus ?? 401, retryAfterMs: null, message: rawMsg };
    }
  }
  // Permission / unauthenticated without explicit status
  if (
    lower.includes("permission denied") ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid api key") ||
    lower.includes("api key error")
  ) {
    if (httpStatus === 429) {
      // prefer rate_limited
    } else if (!lower.includes("quota")) {
      return { code: "invalid_key", httpStatus: httpStatus ?? 401, retryAfterMs: null, message: rawMsg };
    }
  }

  // Rate limited
  if (
    httpStatus === 429 ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted") ||
    lower.includes("429")
  ) {
    return { code: "rate_limited", httpStatus: httpStatus ?? 429, retryAfterMs: retryAfterMs ?? 60_000, message: rawMsg };
  }

  // 400 → transient noRetry — only when truly invalid argument (payload error), not when rate-limit masquerades with 400
  // Prioritize rate_limited above, so we only mark 400 noRetry for concrete invalid-argument signals.
  if (httpStatus === 400 && (lower.includes("invalid argument") || lower.includes("gemini request invalid (400)") || lower.includes("failed_precondition"))) {
    return { code: "transient", httpStatus: 400, retryAfterMs: null, message: rawMsg, noRetry: true };
  }
  if (lower.includes("gemini request invalid (400)") && !lower.includes("quota") && !lower.includes("rate")) {
    return { code: "transient", httpStatus: 400, retryAfterMs: null, message: rawMsg, noRetry: true };
  }
  // Also heuristic: 400-like messages (invalid argument) should not rotate — require explicit 400 status to avoid substring false-positive
  if (httpStatus === 400 && lower.includes("invalid argument")) {
    return { code: "transient", httpStatus: 400, retryAfterMs: null, message: rawMsg, noRetry: true };
  }

  // Network
  if (
    lower.includes("network error") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network request failed")
  ) {
    return { code: "network", httpStatus: null, retryAfterMs: null, message: rawMsg };
  }

  // Abort
  if (lower.includes("aborted") || lower.includes("aborterror") || lower.includes("the operation was aborted")) {
    return { code: "transient", httpStatus: httpStatus ?? null, retryAfterMs: null, message: rawMsg, noRetry: true };
  }

  // 5xx transient
  if (httpStatus != null && httpStatus >= 500 && httpStatus < 600) {
    return { code: "transient", httpStatus, retryAfterMs, message: rawMsg };
  }

  // Fallback transient
  return { code: "transient", httpStatus, retryAfterMs, message: rawMsg };
}

// ── testGeminiKey ──────────────────────────────────────────────────────────

export interface TestGeminiKeyResult {
  ok: boolean;
  latencyMs: number;
  httpStatus: number | null;
  error: string | null;
}

export async function testGeminiKey(apiKey: string, signal?: AbortSignal): Promise<TestGeminiKeyResult> {
  const trimmed = (apiKey ?? "").trim();
  if (!trimmed) {
    return { ok: false, latencyMs: 0, httpStatus: null, error: "Missing API key" };
  }

  // BUG-AUTH-2: Generative Language API requires ?key= query param per docs. Alternative
  // header `x-goog-api-key: <key>` is supported on some endpoints and keeps key out of URL
  // (no Referer/history leak). We keep query for compatibility and rely on
  // Referrer-Policy: no-referrer + CSP connect-src to mitigate. Future: server proxy.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    trimmed
  )}`;

  const body = {
    contents: [{ parts: [{ text: "Reply with 'ok'" }] }],
  };

  const start = Date.now();

  let res: Response;
  try {
    // BUG-AUTH-6: Direct browser→Google fetch is interceptable via window.fetch patch / extension.
    // Mitigated by CSP connect-src and future server proxy. Header alternative `x-goog-api-key`
    // would avoid query leak but is still visible to monkey-patch; both are client-visible.
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: unknown) {
    const latencyMs = Date.now() - start;
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError")) {
      return { ok: false, latencyMs, httpStatus: null, error: "Aborted" };
    }
    const cls = classifyGeminiError(e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latencyMs, httpStatus: cls.httpStatus, error: cls.message || msg };
  }

  const latencyMs = Date.now() - start;

  if (res.ok) {
    return { ok: true, latencyMs, httpStatus: res.status, error: null };
  }

  // Not ok — read error body
  let errText = "";
  try {
    const j = (await res.json()) as Record<string, unknown>;
    const errObj = j?.error as Record<string, unknown> | undefined;
    if (errObj && typeof errObj.message === "string") errText = errObj.message as string;
    else errText = JSON.stringify(j);
    // Check details for retryDelay
    const details = errObj?.details as unknown[] | undefined;
    if (Array.isArray(details)) {
      for (const d of details) {
        const maybe = d as Record<string, unknown>;
        const rd = maybe?.retryDelay;
        if (typeof rd === "string") {
          errText += ` retryDelay: ${rd}`;
        }
      }
    }
  } catch {
    try {
      errText = await res.text();
    } catch {
      errText = res.statusText;
    }
  }

  // Enrich with Retry-After header if present for classification
  let headerRetry: string | null = null;
  try {
    headerRetry = res.headers.get("Retry-After") ?? res.headers.get("retry-after");
  } catch {}
  const combinedForClassify = headerRetry ? `${errText} Retry-After: ${headerRetry}` + ` (${res.status})` : `${errText} (${res.status})`;
  const cls = classifyGeminiError(new Error(combinedForClassify));
  // Prefer actual httpStatus from response
  void cls; // classification side-effects not needed beyond error text, but keep for parity

  return {
    ok: false,
    latencyMs,
    httpStatus: res.status,
    error: errText || res.statusText || `Gemini error ${res.status}`,
  };
}

// ── transcribeWithFallback ─────────────────────────────────────────────────

export interface TranscribeWithFallbackOpts {
  onAttempt?: (attempt: TranscriptionAttempt, idx: number, total: number) => void;
  signal?: AbortSignal;
}

export async function transcribeWithFallback(
  audioBase64: string,
  mimeType: string,
  language: string,
  opts?: TranscribeWithFallbackOpts
): Promise<TranscriptionResultWithMeta> {
  const enabled = getEnabledKeysSorted();

  if (enabled.length === 0) {
    throw new Error("No Gemini API keys configured. Add at least one API key in Settings to transcribe.");
  }

  const attempts: TranscriptionAttempt[] = [];
  const errors: unknown[] = [];

  for (let idx = 0; idx < enabled.length; idx++) {
    const rec = enabled[idx];

    if (opts?.signal?.aborted) {
      throw new DOMException("Transcription aborted", "AbortError");
    }

    // onAttempt callback before each try (provisional)
    if (opts?.onAttempt) {
      try {
        const provisional: TranscriptionAttempt = {
          keyId: rec.id,
          label: rec.label,
          status: "untested",
          httpStatus: null,
          error: null,
          latencyMs: 0,
        };
        opts.onAttempt(provisional, idx, enabled.length);
      } catch {}
    }

    const start = Date.now();

    try {
      const words = await transcribeAudio(audioBase64, mimeType, language, rec.key);
      const latencyMs = Date.now() - start;

      // Success — mark working
      try {
        updateKeyStatus(rec.id, {
          status: "working",
          lastUsedAt: Date.now(),
          lastTestedAt: Date.now(),
          lastError: null,
          lastHttpStatus: 200,
          rateLimitedUntil: null,
        });
      } catch {}

      const attempt: TranscriptionAttempt = {
        keyId: rec.id,
        label: rec.label,
        status: "working",
        httpStatus: 200,
        error: null,
        latencyMs,
      };
      attempts.push(attempt);

      return {
        words,
        successfulKeyId: rec.id,
        successfulLabel: rec.label,
        attempts,
      };
    } catch (e: unknown) {
      const latencyMs = Date.now() - start;
      const classification = classifyGeminiError(e);
      const rawMsg = e instanceof Error ? e.message : String(e);
      const message = classification.message || rawMsg;

      if (opts?.signal?.aborted) {
        throw new DOMException("Transcription aborted", "AbortError");
      }

      let mappedStatus: ApiKeyStatus;
      if (classification.code === "invalid_key") mappedStatus = "invalid";
      else if (classification.code === "rate_limited") mappedStatus = "rate_limited";
      else mappedStatus = "error";

      const httpStatus = classification.httpStatus;

      const attempt: TranscriptionAttempt = {
        keyId: rec.id,
        label: rec.label,
        status: mappedStatus,
        httpStatus,
        error: message,
        latencyMs,
      };
      attempts.push(attempt);
      errors.push(e instanceof Error ? e : new Error(message));

      // Persist status per key
      try {
        const now = Date.now();
        if (classification.code === "invalid_key") {
          updateKeyStatus(rec.id, {
            status: "invalid",
            lastError: message,
            lastHttpStatus: httpStatus,
            lastTestedAt: now,
            rateLimitedUntil: null,
          });
        } else if (classification.code === "rate_limited") {
          const retryMs = classification.retryAfterMs ?? 60_000;
          updateKeyStatus(rec.id, {
            status: "rate_limited",
            lastError: message,
            lastHttpStatus: httpStatus,
            lastTestedAt: now,
            rateLimitedUntil: now + retryMs,
          });
        } else {
          updateKeyStatus(rec.id, {
            status: "error",
            lastError: message,
            lastHttpStatus: httpStatus,
            lastTestedAt: now,
            rateLimitedUntil: null,
          });
        }
      } catch {}

      // 400 invalid_request → do NOT rotate, throw immediately; rate-limited/429 keeps rotating
      if (classification.noRetry) {
        // Throw a GeminiKeyError with attempts context so callers can inspect
        throw new GeminiKeyError(message, httpStatus, classification.code, [...attempts], classification.retryAfterMs ?? null, true);
      }

      // If this was last key, break to aggregate error
      if (idx === enabled.length - 1) break;

      // Delay 180ms before next key (check abort)
      if (opts?.signal?.aborted) {
        throw new DOMException("Transcription aborted", "AbortError");
      }

      await new Promise<void>((resolve, reject) => {
        let onAbort: (() => void) | null = null;
        const t = setTimeout(() => {
          // cleanup listener if still registered
          if (opts?.signal && onAbort) {
            try {
              opts.signal.removeEventListener("abort", onAbort);
            } catch {}
          }
          resolve();
        }, 180);
        if (opts?.signal) {
          onAbort = () => {
            clearTimeout(t);
            try {
              opts.signal!.removeEventListener("abort", onAbort!);
            } catch {}
            reject(new DOMException("Aborted", "AbortError"));
          };
          opts.signal.addEventListener("abort", onAbort, { once: true });
        }
      }).catch((abortErr) => {
        throw abortErr;
      });

      if (opts?.signal?.aborted) {
        throw new DOMException("Transcription aborted", "AbortError");
      }

      // continue to next key
    }
  }

  // All keys exhausted
  const lastErr = attempts[attempts.length - 1]?.error ?? "unknown error";
  const summary = `All ${enabled.length} Gemini API keys failed. Last error: ${lastErr}`;
  const agg: AggregateError & { attempts?: TranscriptionAttempt[] } = new AggregateError(errors as Error[], summary) as unknown as AggregateError & {
    attempts?: TranscriptionAttempt[];
  };
  (agg as unknown as Record<string, unknown>).attempts = attempts;
  throw agg;
}

// ── Existing transcription (single-key) ────────────────────────────────────

/**
 * Calls Gemini 2.5 Flash to transcribe audio.
 * @param audioBase64 - base64-encoded audio without data URI prefix
 * @param mimeType - audio MIME type, e.g. "audio/mpeg" or "audio/aac"
 * @param language - BCP-47 code e.g. "en"
 * @param apiKey - Gemini API key
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  language: string,
  apiKey: string
): Promise<WordToken[]> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing Gemini API key. Paste your key to continue.");
  }
  if (!audioBase64) {
    throw new Error("No audio data to transcribe.");
  }

  // BUG-AUTH-2: See testGeminiKey comment — ?key= is required per Generative Language API docs.
  // Mitigated by Referrer-Policy: no-referrer. Header alternative `x-goog-api-key` exists but still
  // client-visible; prefer server proxy for billed keys.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey.trim()
  )}`;

  const prompt = buildPrompt(language);

  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  let res: Response;
  try {
    // BUG-AUTH-6: See header comment — browser→Google is monkey-patch interceptable.
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error reaching Gemini: ${msg}. Check your connection and try again.`);
  }

  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {
      try {
        errText = await res.text();
      } catch {
        errText = res.statusText;
      }
    }

    if (res.status === 400) {
      throw new Error(`Gemini request invalid (400): ${errText || "Check audio format."}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Gemini API key error (${res.status}). Check your API key and try again. ${errText ? "Details: " + errText : ""}`.trim()
      );
    }
    if (res.status === 429) {
      throw new Error(`Gemini quota exceeded (429). ${errText || "Try again in a minute."}`);
    }
    throw new Error(`Gemini API error ${res.status}: ${errText || res.statusText}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Failed to parse Gemini response JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Extract text from candidates[0].content.parts[0].text
  const anyJson = json as Record<string, unknown>;
  const candidates = (anyJson?.candidates as unknown[]) ?? [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    // Check for promptFeedback block
    const fb = (anyJson?.promptFeedback as Record<string, unknown> | undefined)?.blockReason;
    if (fb) throw new Error(`Gemini blocked the request: ${String(fb)}`);
    throw new Error("Gemini returned no candidates. Try again or check audio length.");
  }

  const first = candidates[0] as Record<string, unknown>;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as unknown[]) ?? [];
  let text = "";
  for (const p of parts) {
    const maybeText = (p as Record<string, unknown>)?.text;
    if (typeof maybeText === "string") text += maybeText;
  }

  if (!text || !text.trim()) {
    // Some errors in candidate finishReason
    const reason = (first?.finishReason as string) ?? "UNKNOWN";
    throw new Error(`Gemini returned empty transcription (reason: ${reason}). Try again with a shorter clip.`);
  }

  // Strip markdown fences and extract JSON array
  let raw = text.trim();
  // Handle ```json fences
  if (raw.includes("```")) {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (m) raw = m[1].trim();
  }
  // If still surrounding prose, slice to first [ and last ]
  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    raw = raw.slice(firstBracket, lastBracket + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Attempt to recover: find JSON array via regex
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        throw new Error(
          `Gemini response was not valid JSON. Raw preview: ${raw.slice(0, 400)}... (${e instanceof Error ? e.message : String(e)})`
        );
      }
    } else {
      throw new Error(
        `Could not parse Gemini transcription JSON. Raw preview: ${raw.slice(0, 400)}... (${e instanceof Error ? e.message : String(e)})`
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini transcription format error: expected JSON array.");
  }

  const words: WordToken[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const word = typeof o.word === "string" ? o.word : typeof o.text === "string" ? (o.text as string) : null;
    const startMs = typeof o.startMs === "number" ? o.startMs : typeof o.start === "number" ? (o.start as number) : null;
    const endMs = typeof o.endMs === "number" ? o.endMs : typeof o.end === "number" ? (o.end as number) : null;
    if (word == null || startMs == null || endMs == null) continue;
    // Normalize to numbers; Gemini may return strings
    const s = Number(startMs);
    const eMs = Number(endMs);
    if (!Number.isFinite(s) || !Number.isFinite(eMs)) continue;
    const confidence = typeof o.confidence === "number" ? o.confidence : o.confidence != null ? Number(o.confidence) : undefined;
    words.push({
      word: String(word),
      startMs: s,
      endMs: eMs,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : undefined,
    });
  }

  if (words.length === 0) {
    throw new Error("Gemini returned no word timestamps. Try a different clip or check language setting.");
  }

  // Ensure sorted by startMs
  words.sort((a, b) => a.startMs - b.startMs);

  return words;
}
