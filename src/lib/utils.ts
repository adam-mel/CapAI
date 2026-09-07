/**
 * CapAI — Shared utilities
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ── Tailwind merge ───────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Time formatting ──────────────────────────────────────────────────

/**
 * Format milliseconds as MM:SS.mmm (e.g. 00:02.140)
 * Used for caption timestamps
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/**
 * Format milliseconds as M:SS or H:MM:SS using locale-aware formatter (UI-16)
 * Guard future diff not applicable here; returns 0:00 for invalid ms
 */
export function formatDuration(ms: number, locale?: string): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  // Locale-aware zero padding via Intl.NumberFormat
  const loc = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  try {
    const nf = new Intl.NumberFormat(loc, { minimumIntegerDigits: 2 });
    if (hours > 0) return `${hours}:${nf.format(minutes)}:${nf.format(seconds)}`;
    return `${minutes}:${nf.format(seconds)}`;
  } catch {
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
}

/**
 * Parse a timestamp string "MM:SS.mmm" or "H:MM:SS.mmm" into milliseconds
 * Returns null if invalid. Accepts 1-3 digit millis (e.g. "00:05.5" → 500ms, "00:05.05" → 50ms? treated as 050).
 */
export function parseTime(value: string): number | null {
  const trimmed = value.trim();
  // H:MM:SS.mmm  or  MM:SS.mmm  (hours optional, millis optional)
  const hms = trimmed.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (hms) {
    const hours = Number(hms[1]);
    const minutes = Number(hms[2]);
    const seconds = Number(hms[3]);
    const millis = Number(hms[4].padEnd(3, "0"));
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 * 1000 + minutes * 60 * 1000 + seconds * 1000 + millis;
  }
  const hmsNoMs = trimmed.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hmsNoMs) {
    const hours = Number(hmsNoMs[1]);
    const minutes = Number(hmsNoMs[2]);
    const seconds = Number(hmsNoMs[3]);
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 * 1000 + minutes * 60 * 1000 + seconds * 1000;
  }
  const match = trimmed.match(/^(\d+):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  // padEnd normalizes "5"→"500" (500ms), "50"→"500" (500ms), "050"→"050" (50ms). 2-digit input is 500ms, not 50ms — document asymmetry.
  const millis = Number(match[3].padEnd(3, "0"));
  if (seconds >= 60) return null;
  return minutes * 60 * 1000 + seconds * 1000 + millis;
}

// ── Relative time ────────────────────────────────────────────────────

/**
 * Human-readable relative time using Intl.RelativeTimeFormat when available (UI-16)
 * Falls back to English literal for SSR/no-Intl env
 */
export function relativeTime(timestamp: number, locale?: string): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) return "Just now";
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const loc = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en");

  try {
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
    if (seconds < 60) return rtf.format(-seconds, "second");
    if (minutes < 60) return rtf.format(-minutes, "minute");
    if (hours < 24) return rtf.format(-hours, "hour");
    if (days === 1) return rtf.format(-1, "day");
    if (days < 7) return rtf.format(-days, "day");
    if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
    if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
    return rtf.format(-Math.floor(days / 365), "year");
  } catch {
    if (seconds < 60) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }
}

// ── File helpers ─────────────────────────────────────────────────────

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/avi", "video/x-msvideo"];
export const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];

export function isValidVideoFile(file: File): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
  if (ACCEPTED_VIDEO_TYPES.includes(file.type)) return true;
  // Fallback: check extension loosely for browser MIME inconsistencies
  return ACCEPTED_EXTENSIONS.some((e) => file.name.toLowerCase().endsWith(e));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size % 1 === 0 ? size.toString() : size.toFixed(1)} ${units[i]}`;
}

export function truncateFilename(name: string, maxLen = 24): string {
  if (name.length <= maxLen) return name;
  const ext = name.includes(".") ? "." + name.split(".").pop() : "";
  const base = name.slice(0, maxLen - ext.length - 3);
  return `${base}...${ext}`;
}

// ── UUID & misc ──────────────────────────────────────────────────────

export function generateId(): string {
  // Use crypto.randomUUID when available, fallback to simple random
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 9);
}
