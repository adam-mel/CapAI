/**
 * CapAI — IndexedDB via Dexie
 * PRD §8.1 — Database: capai_db v1, table: projects
 *
 * Migrations: see /migrations/README.md
 * DB_VERSION = 2 (projects + apiKeys). Fresh installs get merged stores.
 * Never drop a store declaration in a new version — Dexie merges implicitly but we declare explicitly.
 *
 * SECURITY NOTES (BUG-AUTH-7, BUG-AUTH-10):
 * - BUG-AUTH-7: No authentication / authorization on IndexedDB — any JS on origin can
 *   enumerate `db.projects.toArray()` and read `videoBlob`/segments. This is intentional
 *   for local-first single-user: there is no login, no middleware, no Supabase. On shared
 *   device, second user can see first user's projects; XSS can exfiltrate blobs.
 *   Mitigation: document single-user threat model, offer "Clear all projects" / Lock UI,
 *   future optional passphrase-encrypted IndexedDB (WebCrypto) with per-project ownerId.
 * - BUG-AUTH-10: `capai_last_project_id` in localStorage is cleared when that project is deleted.
 * - BUG-AUTH-11: No cookies today (CSRF moot). If adding API routes with cookies, add
 *   SameSite/CSRF checks (see next.config.ts).
 */

import Dexie, { type Table } from "dexie";
import type { Project, GeminiKeyRecord } from "./types";
import { placeholderThumbnail, isValidThumbnailDataUrl } from "./thumbnail";

// ── Dexie DB ─────────────────────────────────────────────────────────

export const DB_VERSION = 2;

export class CapAIDatabase extends Dexie {
  projects!: Table<Project, string>;
  apiKeys!: Table<GeminiKeyRecord, string>;

  constructor() {
    super("capai_db");
    // v1: projects only
    this.version(1).stores({
      projects: "id, name, createdAt, updatedAt",
    });
    // v2: adds apiKeys. Re-declare projects so fresh install (no v1 DB) still gets projects indexes.
    // Dexie merges stores, but explicit redeclaration documents intent and prevents accidental drop.
    this.version(2)
      .stores({
        projects: "id, name, createdAt, updatedAt",
        apiKeys: "id, priority, isActive",
      })
      .upgrade(async (tx) => {
        // Backfill hook for future schema changes.
        // v1 -> v2 has no project field migration; placeholder for example:
        // await tx.table("projects").toCollection().modify((p: Project) => {
        //   if (!p.createdAt) p.createdAt = p.updatedAt ?? Date.now();
        // });
        void tx;
      });
  }
}

export const db = new CapAIDatabase();

// Dexie validation hooks — enforce thumbnail sanitization at persistence boundary (see BUG-DATA-12, BUG-DATA-3)
db.projects.hook("creating", (_primKey, obj) => {
  const p = obj as unknown as Project;
  // Sanitize thumbnailDataUrl — replace truncated/oversized with placeholder
  if (!isValidThumbnailDataUrl(p.thumbnailDataUrl)) {
    // Allow SVG placeholder; otherwise fallback
    const sanitized = sanitizeThumbnailDataUrl(p.thumbnailDataUrl);
    p.thumbnailDataUrl = sanitized ?? placeholderThumbnail();
  }
  // Clamp wordsPerSegment to union 2|3|4|5
  if (p.settings) {
    const w = p.settings.wordsPerSegment as unknown as number;
    if (![2, 3, 4, 5].includes(w)) {
      const clamped = Math.max(2, Math.min(5, Math.floor(Number(w) || 3))) as 2 | 3 | 4 | 5;
      p.settings.wordsPerSegment = clamped;
    }
  }
  // Ensure timestamps
  const now = Date.now();
  if (typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) p.createdAt = now;
  if (typeof p.updatedAt !== "number" || !Number.isFinite(p.updatedAt)) p.updatedAt = now;
  // Validate segments invariants (drop inverted)
  if (Array.isArray(p.segments)) {
    p.segments = p.segments.filter((s) => typeof s.startMs === "number" && typeof s.endMs === "number" && s.startMs < s.endMs);
    p.segments.sort((a, b) => a.startMs - b.startMs);
  }
});

db.projects.hook("updating", (mods) => {
  const m = mods as Partial<Project> & Record<string, unknown>;
  if ("thumbnailDataUrl" in m) {
    const url = m.thumbnailDataUrl as unknown;
    if (!isValidThumbnailDataUrl(url)) {
      const sanitized = sanitizeThumbnailDataUrl(url);
      (m as Record<string, unknown>).thumbnailDataUrl = sanitized ?? placeholderThumbnail();
    }
  }
  if (m.settings) {
    const w = (m.settings as unknown as { wordsPerSegment: unknown }).wordsPerSegment as number;
    if (![2, 3, 4, 5].includes(w)) {
      const clamped = Math.max(2, Math.min(5, Math.floor(Number(w) || 3))) as 2 | 3 | 4 | 5;
      (m.settings as unknown as { wordsPerSegment: number }).wordsPerSegment = clamped;
    }
  }
  if (m.segments && Array.isArray(m.segments)) {
    (m as Record<string, unknown>).segments = (m.segments as Project["segments"])
      .filter((s) => typeof s.startMs === "number" && typeof s.endMs === "number" && s.startMs < s.endMs)
      .sort((a, b) => a.startMs - b.startMs);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

export async function getAllProjects(): Promise<Project[]> {
  return db.projects.orderBy("updatedAt").reverse().toArray();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  const name = err.name as string | undefined;
  const msg = (err.message as string | undefined) ?? "";
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    msg.includes("QuotaExceededError") ||
    msg.includes("quota") ||
    (err.code as unknown) === 22
  );
}

function validateProjectForPersist(project: Project): void {
  if (!project || typeof project !== "object") throw new Error("Invalid project: missing object");
  if (!project.id || typeof project.id !== "string" || !project.id.trim()) throw new Error("Invalid project: id is required");
  if (!project.name || typeof project.name !== "string" || !project.name.trim()) throw new Error("Invalid project: name is required");
  if (typeof project.createdAt !== "number" || !Number.isFinite(project.createdAt)) throw new Error("Invalid project: createdAt must be a timestamp");
  if (typeof project.updatedAt !== "number" || !Number.isFinite(project.updatedAt)) throw new Error("Invalid project: updatedAt must be a timestamp");
  if (!(project.videoBlob instanceof Blob) && project.videoBlob != null) {
    // Dexie clones Blob via structured clone; Node test env may use plain object — warn but allow if size check passes
    const maybeBlob = project.videoBlob as unknown as { size?: number };
    if (typeof maybeBlob?.size !== "number") throw new Error("Invalid project: videoBlob must be a Blob");
  }
  // settings clamp handled in hooks, but also validate here
  const w = project.settings?.wordsPerSegment as unknown as number;
  if (![2, 3, 4, 5].includes(w)) {
    throw new Error("Invalid project: settings.wordsPerSegment must be 2|3|4|5");
  }
  if (!Array.isArray(project.segments)) throw new Error("Invalid project: segments must be array");
  for (const s of project.segments) {
    if (typeof s.startMs !== "number" || typeof s.endMs !== "number" || s.startMs >= s.endMs) {
      throw new Error(`Invalid segment ${s.id}: startMs must be < endMs`);
    }
  }
  // Sort check
  for (let i = 1; i < project.segments.length; i++) {
    if (project.segments[i].startMs < project.segments[i - 1].startMs) {
      throw new Error("Invalid segments: must be sorted by startMs");
    }
  }
}

export async function saveProject(project: Project): Promise<string> {
  const now = Date.now();
  // Ensure timestamps, sanitize thumbnail, clamp settings
  let toSave: Project = {
    ...project,
    name: (project.name ?? "").trim() || project.name,
    createdAt: typeof project.createdAt === "number" && Number.isFinite(project.createdAt) ? project.createdAt : now,
    updatedAt: now,
  };
  // Sanitize thumbnail at boundary (defense in depth — hook also does)
  if (!isValidThumbnailDataUrl(toSave.thumbnailDataUrl)) {
    const sanitized = sanitizeThumbnailDataUrl(toSave.thumbnailDataUrl);
    toSave.thumbnailDataUrl = (sanitized ?? placeholderThumbnail()) as unknown as string;
  }
  // Clamp wordsPerSegment
  if (toSave.settings) {
    const w = toSave.settings.wordsPerSegment as unknown as number;
    if (![2, 3, 4, 5].includes(w)) {
      toSave.settings = { ...toSave.settings, wordsPerSegment: Math.max(2, Math.min(5, Math.floor(Number(w) || 3))) as 2 | 3 | 4 | 5 };
    }
  }
  // Sort/filter segments
  if (Array.isArray(toSave.segments)) {
    toSave.segments = [...toSave.segments]
      .filter((s) => typeof s.startMs === "number" && typeof s.endMs === "number" && s.startMs < s.endMs)
      .sort((a, b) => a.startMs - b.startMs);
  }

  // Validate before write
  try {
    validateProjectForPersist(toSave);
  } catch (e) {
    throw e;
  }

  try {
    await db.projects.put(toSave);
  } catch (e) {
    if (isQuotaError(e)) {
      throw new Error("Storage quota exceeded. Free up space or use a shorter video. (QuotaExceededError)");
    }
    throw e;
  }
  return toSave.id;
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
  // BUG-AUTH-10: Clear stale capai_last_project_id if it points to deleted project
  if (typeof window !== "undefined") {
    try {
      const last = localStorage.getItem("capai_last_project_id");
      if (last === id) {
        localStorage.removeItem("capai_last_project_id");
      }
    } catch {}
  }
}

export async function createProject(project: Project): Promise<string> {
  const now = Date.now();
  const withTimestamps: Project = {
    ...project,
    createdAt: typeof project.createdAt === "number" && Number.isFinite(project.createdAt) ? project.createdAt : now,
    updatedAt: typeof project.updatedAt === "number" && Number.isFinite(project.updatedAt) ? project.updatedAt : now,
  };
  // Sanitize thumbnail
  if (!isValidThumbnailDataUrl(withTimestamps.thumbnailDataUrl)) {
    const sanitized = sanitizeThumbnailDataUrl(withTimestamps.thumbnailDataUrl);
    withTimestamps.thumbnailDataUrl = (sanitized ?? placeholderThumbnail()) as unknown as string;
  }
  // Clamp wordsPerSegment
  if (withTimestamps.settings) {
    const w = withTimestamps.settings.wordsPerSegment as unknown as number;
    if (![2, 3, 4, 5].includes(w)) {
      withTimestamps.settings = { ...withTimestamps.settings, wordsPerSegment: Math.max(2, Math.min(5, Math.floor(Number(w) || 3))) as 2 | 3 | 4 | 5 };
    }
  }
  if (Array.isArray(withTimestamps.segments)) {
    withTimestamps.segments = [...withTimestamps.segments]
      .filter((s) => typeof s.startMs === "number" && typeof s.endMs === "number" && s.startMs < s.endMs)
      .sort((a, b) => a.startMs - b.startMs);
  }
  try {
    validateProjectForPersist(withTimestamps);
  } catch (e) {
    throw e;
  }
  try {
    await db.projects.add(withTimestamps);
  } catch (e) {
    if (isQuotaError(e)) {
      throw new Error("Storage quota exceeded. Free up space or use a shorter video. (QuotaExceededError)");
    }
    // Dexie throws ConstraintError on duplicate id — surface clearly
    if ((e as Record<string, unknown>)?.name === "ConstraintError") {
      throw new Error(`Project id already exists: ${withTimestamps.id}`);
    }
    throw e;
  }
  return withTimestamps.id;
}

// ── Thumbnail validation ──────────────────────────────────────────
// isValidThumbnailDataUrl is canonical in ./thumbnail.ts — re-export for backwards compat (single source of truth)
export { isValidThumbnailDataUrl };

/**
 * Return a sanitized thumbnail URL or null if invalid/truncated.
 * Use when reading from IndexedDB before rendering in ProjectCard.
 */
export function sanitizeThumbnailDataUrl(url: unknown): string | null {
  if (isValidThumbnailDataUrl(url)) return url as string;
  return null;
}
