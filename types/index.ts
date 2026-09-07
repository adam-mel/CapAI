/**
 * CapAI — Core Data Model
 * PRD §5.1 — TypeScript interfaces for projects, segments, styles
 */

// ── Project ──────────────────────────────────────────────────────────

export interface Project {
  id: string; // uuid v4
  name: string; // from filename, user-renameable
  createdAt: number; // Unix ms timestamp
  updatedAt: number; // Unix ms timestamp
  videoBlob: Blob; // stored in IndexedDB
  thumbnailDataUrl: string; // first-frame JPEG data URI
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
