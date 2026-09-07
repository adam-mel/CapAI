/**
 * CapAI — Core Data Model
 * PRD §5.1 — TypeScript interfaces for projects, segments, styles
 */

// ── Project ──────────────────────────────────────────────────────────

export const DB_VERSION = 2;

/**
 * Branded thumbnail data URL — only valid JPEG base64 >1k<500k or SVG placeholder.
 * Use `isValidThumbnailDataUrl` / `sanitizeThumbnailDataUrl` to validate before persisting.
 * Persisting an unvalidated string risks broken dashboard cards (ERR_INVALID_URL).
 */
export type ThumbnailDataUrl = string & { readonly __brand: "ThumbnailDataUrl" };

export function isValidThumbnailBranded(url: string): url is ThumbnailDataUrl {
  if (!url) return false;
  if (url.startsWith("data:image/svg+xml")) return true;
  return url.startsWith("data:image/jpeg;base64,") && url.length > 1000 && url.length < 500000;
}

export interface Project {
  id: string; // uuid v4
  name: string; // from filename, user-renameable
  createdAt: number; // Unix ms timestamp
  updatedAt: number; // Unix ms timestamp
  videoBlob: Blob; // stored in IndexedDB
  thumbnailDataUrl: ThumbnailDataUrl | string; // branded if validated; string fallback for legacy reads
  settings: ProjectSettings;
  captionStyle: CaptionStyle;
  segments: CaptionSegment[]; // user's working copy
  originalSegments: CaptionSegment[]; // Gemini output — never mutated directly
}

// ── Project Settings ─────────────────────────────────────────────────

export interface ProjectSettings {
  mode: "dynamic" | "static";
  language: string; // BCP-47: "en", "fr", "ar", etc.
  wordsPerSegment: 2 | 3 | 4 | 5;
  rtl: boolean; // derived from language
}

// ── Caption Segment ──────────────────────────────────────────────────

export interface CaptionSegment {
  id: string; // uuid
  startMs: number;
  endMs: number;
  text: string; // full text of segment
  words: WordToken[]; // word-level timing (for Dynamic mode)
  confidence?: number; // min confidence across words (0–1)
}

// ── Word Token ───────────────────────────────────────────────────────

export interface WordToken {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number; // per-word confidence from Gemini
}

// ── Caption Style ────────────────────────────────────────────────────

export type PresetName = "Reels" | "Clean" | "Bold Drop" | "Custom";

export interface CaptionStyle {
  preset: PresetName;

  // Font
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 700 | 900;
  fontStyle: "normal" | "italic";
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
  textAlign: "left" | "center" | "right";

  // Colors
  color: string; // hex
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;

  // Background pill
  pillEnabled: boolean;
  pillColor: string;
  pillOpacity: number; // 0–1
  pillPaddingX: number;
  pillPaddingY: number;
  pillRadius: number;

  // Dynamic mode highlight
  highlightStyle: "karaoke" | "pill" | "pop";
  activeWordColor: string;
  inactiveWordColor: string;

  // Position
  positionPreset: "top" | "center" | "bottom";
  positionOffsetY: number; // px, –50 to +50
  hAlign: "left" | "center" | "right";
}

// ── Helper: RTL languages ────────────────────────────────────────────

export const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(lang.toLowerCase());
}

// ── Gemini Multi-Key ─────────────────────────────────────────────────

export type ApiKeyStatus = "untested" | "working" | "invalid" | "rate_limited" | "error";

export interface GeminiKeyRecord {
  id: string;
  label: string;
  key: string;
  isActive: boolean;
  priority: number;
  status: ApiKeyStatus;
  lastTestedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  rateLimitedUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptionAttempt {
  keyId: string;
  label: string;
  status: ApiKeyStatus;
  httpStatus: number | null;
  error: string | null;
  latencyMs: number;
}

export interface TranscriptionResultWithMeta {
  words: WordToken[];
  successfulKeyId: string;
  successfulLabel: string;
  attempts: TranscriptionAttempt[];
}

export const GEMINI_KEYS_STORAGE_KEY = "capai_gemini_api_keys";
export const GEMINI_LEGACY_KEY = "capai_gemini_api_key";
