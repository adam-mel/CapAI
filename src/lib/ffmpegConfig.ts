/**
 * CapAI — Shared FFmpeg core version (single source of truth)
 * Both export.ts (burn-in) and ffmpeg.ts (audio extraction) must share same core
 * to avoid double-cached toBlobURL mismatches and to guarantee libass+fonts.
 *
 * Two singletons share same core version but separate FS/mounts — OK to keep
 * isolated instances so audio extraction and export do not clobber each other's
 * in-memory filesystem. They load same URLs; toBlobURL caching will dedupe
 * network fetch, but each FFmpeg instance has its own MEMFS.
 *
 * Do NOT merge into one singleton — audio extraction runs before export and
 * termination semantics (e.g., export abort -> ffmpeg.terminate()) must not
 * kill the transcription pipeline.
 *
 * Known-good: @ffmpeg/core 0.12.10 includes --enable-libass + fonts
 * (0.12.6 predated fonts fix; 0.12.15 not published for core — 0.12.10 is last stable with libass).
 */
export const CORE_VERSION = "0.12.10";
export const CORE_BASE = "/ffmpeg";
export const CORE_BASE_ESM = "/ffmpeg";
