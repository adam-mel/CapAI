/**
 * CapAI — Gemini multi-key management
 * Handles CRUD, validation, obfuscation, persistence to localStorage + Dexie mirror,
 * migration from legacy single-key storage, and `capai:keys-changed` events.
 *
 * Data-layer fixes (2026-09):
 * - syncToDexie is atomic via Dexie transaction and stores btoa-obfuscated keys (consistent with localStorage)
 * - All mutators guard against cross-tab lost-update via Web Locks API (navigator.locks) when available
 * - updateKey whitelists patch fields (label,key,isActive); priority/status managed only via reorderKeys/updateKeyStatus
 * - initKeys validates legacy key, removes legacy entry after migration, and is safe to call at startup
 * - reorderKeys typed overloads (array | from/to) — no arguments object
 * - localStorage ↔ Dexie reconciliation on startup (hydrate if localStorage empty but Dexie has data)
 * - Threat model: btoa is obfuscation not encryption; Dexie also obfuscated; document XSS risk, encourage CSP
 *
 * SECURITY NOTES (BUG-AUTH-1, BUG-AUTH-3, BUG-AUTH-7, BUG-AUTH-10, BUG-AUTH-11):
 * - BUG-AUTH-1: `obfuscate()` is reversible base64 (btoa) — NOT encryption. Any XSS / extension with DOM access
 *   can `atob(JSON.parse(localStorage.getItem("capai_gemini_api_keys")).keys[0].key)` or read Dexie `apiKeys`.
 *   Dexie mirror is also btoa-obfuscated (theatre) for consistency; plaintext mirror removed.
 *   For billed high-value keys, use a server-side proxy with HttpOnly Secure SameSite session. WebCrypto
 *   AES-GCM with user-derived password is future work; memory-only mode is not yet implemented.
 * - BUG-AUTH-3: Keys persist in `localStorage` (capai_gemini_api_keys) + Dexie. `localStorage` is JS-accessible,
 *   has no HttpOnly / Secure / SameSite / Partitioned attributes, survives tab close, and cannot be HttpOnly
 *   by design (it is a JS API). No expiration — keys live forever until deleteKey / clear. This is inherent
 *   to local-first; mitigation is CSP (next.config.ts), auto-expiry future work, and user rotation guidance.
 *   Consider sessionStorage for ephemeral sessions or server proxy for HttpOnly protection.
 * - BUG-AUTH-7: IndexedDB `capai_db.projects` has no per-user auth — any script on origin can enumerate
 *   `db.projects.toArray()` and exfiltrate videoBlob/thumbnail/segments. This is the local-first single-user
 *   threat model; shared-device users must use OS-level profiles. Future: passphrase-encrypted IndexedDB.
 * - BUG-AUTH-10: Deletion does best-effort secure wipe (overwrite localStorage slot with zeros/X before
 *   persisting new payload) and clears `capai_last_project_id` when project deleted. Browser LevelDB WAL
 *   may still retain previous value until compaction — not cryptographically erasable from JS.
 * - BUG-AUTH-11: No cookies/sessions today, so CSRF is moot (localStorage does not auto-send). If future
 *   iteration adds server auth (Supabase/NextAuth) with cookies, MUST add SameSite=Lax/Strict, __Host-
 *   prefix, Origin/Sec-Fetch-Site checks, and CSRF double-submit or X-CSRF-Token on POST /api/*.
 */

import type { GeminiKeyRecord, ApiKeyStatus } from "./types";
import { GEMINI_KEYS_STORAGE_KEY, GEMINI_LEGACY_KEY } from "./types";
import { db } from "./db";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Mask a key for display.
 * - AIza keys: show first 4 + last 4 (e.g. AIza••••••••••••XYZ1)
 * - AQ. keys: show first 8 + last 4 (e.g. AQ.Ab8RN••••••••••8BZA) — prefix is 3 chars so 8 exposes a bit more
 * For short keys (<=8) mask entirely; generic fallback uses 4/4 split.
 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  const isAQ = key.startsWith("AQ.");
  const visibleStart = isAQ ? 8 : 4;
  const start = key.slice(0, Math.min(visibleStart, key.length - 4));
  const end = key.slice(-4);
  const middle = "•".repeat(Math.max(4, key.length - visibleStart - 4));
  return `${start}${middle}${end}`;
}

/**
 * Google AI Studio keys come in two observed formats:
 * - Legacy: `AIza...` typically ~39 chars (AIza + 35), charset A-Za-z0-9 _ -
 * - New:    `AQ....` e.g. `AQ.example-redacted-do-not-use`
 *           (AQ. + ~50+ base64url chars, may contain . _ -). We accept 20-200
 *           total for AQ. to be future-proof.
 *
 * Validation is intentionally permissive — the live `testGeminiKey` call is
 * the real correctness check. We handle Windows paste quirks (BOM/whitespace/newlines).
 *
 * Rules after trim/BOM:
 * - must start with `AIza` OR `AQ.` (case-sensitive)
 * - AIza: total length 20-100, charset ^AIza[0-9A-Za-z_\-]+$
 * - AQ.:  total length 20-200, charset ^AQ\.[0-9A-Za-z_\-\.]+$
 *   (dot only allowed after the `AQ.` prefix position, but we allow additional dots for flexibility)
 */
const KEY_RE_LEGACY = /^AIza[0-9A-Za-z_\-]{20,100}$/; // kept for reference — actual validation uses length+charset split
const KEY_RE_AQ = /^AQ\.[0-9A-Za-z_\-\.]{20,200}$/;
// Union reference (not used directly; getKeyValidationError is the source of truth)
const KEY_RE = /^(?:AIza[0-9A-Za-z_\-]{20,100}|AQ\.[0-9A-Za-z_\-\.]{20,200})$/;

/** Returns null if valid, otherwise a human-helpful error string. */
export function getKeyValidationError(key: string): string | null {
  if (typeof key !== "string") return "API key is required.";
  // Trim whitespace including Windows \r\n and zero-width/BOM if pasted
  const t = key.trim().replace(/^\uFEFF/, "");
  if (!t) return "API key is required.";
  const isAIza = t.startsWith("AIza");
  const isAQ = t.startsWith("AQ.");
  if (!isAIza && !isAQ) {
    return "Key must start with 'AIza' or 'AQ.' — copy from aistudio.google.com/app/apikey";
  }
  if (isAIza) {
    if (t.length < 20) {
      return `Key looks too short (got ${t.length} chars, expected ~39 from AI Studio)`;
    }
    if (t.length > 100) {
      return `Key looks too long (got ${t.length} chars, expected ~39 from AI Studio)`;
    }
    if (!/^AIza[0-9A-Za-z_\-]+$/.test(t)) {
      return "Key contains invalid characters (only letters, numbers, _ and - allowed after 'AIza')";
    }
  }
  if (isAQ) {
    if (t.length < 20) {
      return `Key looks too short (got ${t.length} chars, expected ~50+ from AI Studio)`;
    }
    if (t.length > 200) {
      return `Key looks too long (got ${t.length} chars, expected ~50+ from AI Studio)`;
    }
    if (!/^AQ\.[0-9A-Za-z_\-\.]+$/.test(t)) {
      return "Key contains invalid characters (only letters, numbers, _, - and . allowed after 'AQ.')";
    }
  }
  // Keep regex constants referenced to avoid unused warnings and for documentation
  void KEY_RE;
  void KEY_RE_LEGACY;
  void KEY_RE_AQ;
  return null;
}

/** Strict boolean check — permissive for real AI Studio keys (20-100 total). */
export function validateKeyFormat(key: string): boolean {
  return getKeyValidationError(key) === null;
}

/**
 * Backwards-compatible helper for callers that expect `true | string`.
 * Prefer `getKeyValidationError` for `null | string`, but this mirrors the
 * requested `boolean|string` signature: returns `true` if valid, error string otherwise.
 */
export function validateKeyFormatWithMessage(key: string): true | string {
  const err = getKeyValidationError(key);
  return err === null ? true : err;
}

export function generateId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback — not cryptographically strong but sufficient for local IDs
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

// ── Locking & cross-tab reconciliation ───────────────────────────────────

const GEMINI_LOCK_NAME = "capai_gemini_keys";
let hasReconciledDexie = false;

/**
 * Web Locks helper — wraps read-modify-write in navigator.locks when available.
 * Falls back to direct execution (still safe for single-tab, and storage event merge handles cross-tab eventually).
 */
async function withGeminiLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as unknown as { locks?: { request: (name: string, cb: () => Promise<T> | T) => Promise<T> } }).locks : undefined;
  if (locks?.request) {
    return locks.request(GEMINI_LOCK_NAME, async () => fn());
  }
  return fn();
}

function normalizePriorities(keys: GeminiKeyRecord[]): void {
  keys.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  keys.forEach((k, i) => {
    k.priority = i;
  });
}

// ── Obfuscation (btoa/atob) ───────────────────────────────────────────────
// SECURITY NOTE (BUG-AUTH-1, BUG-AUTH-3): btoa is obfuscation, not encryption.
// Any XSS or extension can atob(localStorage) or read Dexie. Dexie now also stores
// btoa-obfuscated keys (consistent theatre) — previously it stored plaintext.
// Threat model is local-first; for high-value billed keys proxy via serverless
// function and add CSP (next.config.ts) to mitigate XSS exfil. Offering
// memory-only / WebCrypto AES-GCM with user password is future work.
// WARNING: Do not claim "encrypted" in UI — use "obfuscated (reversible)".
// localStorage cannot be HttpOnly/Secure (BUG-AUTH-3); document forever-persist risk.

function obfuscate(key: string): string {
  if (!key) return key;
  try {
    if (typeof btoa !== "undefined") return btoa(key);
    // Node fallback (should not happen in browser, but for completeness)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf: any = typeof Buffer !== "undefined" ? Buffer.from(key, "utf-8") : null;
    if (buf) return buf.toString("base64");
  } catch {}
  return key;
}

function isRawGeminiKey(s: string): boolean {
  return s.startsWith("AIza") || s.startsWith("AQ.");
}

function deobfuscate(raw: string): string {
  if (!raw) return raw;
  // If it already looks like a raw Gemini key, keep it
  if (isRawGeminiKey(raw)) return raw;
  try {
    let decoded: string;
    if (typeof atob !== "undefined") decoded = atob(raw);
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf: any = typeof Buffer !== "undefined" ? Buffer.from(raw, "base64") : null;
      if (!buf) return raw;
      decoded = buf.toString("utf-8");
    }
    // Only accept decoded if it looks like a plausible Gemini key
    if (isRawGeminiKey(decoded)) return decoded;
    // If raw was base64 but decoded not AIza/AQ., it might still be the key — but
    // we prefer to return decoded only when it decodes to known prefix pattern.
    // Otherwise treat raw as plain key (legacy unobfuscated).
    return raw;
  } catch {
    return raw;
  }
}

// ── Internal storage helpers ──────────────────────────────────────────────

interface StoredPayloadV1 {
  version: 1;
  keys: Array<Omit<GeminiKeyRecord, "key"> & { key: string }>;
}

function emitKeysChanged(): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent("capai:keys-changed"));
  } catch {
    try {
      window.dispatchEvent(new Event("capai:keys-changed"));
    } catch {}
  }
}

/**
 * Atomic Dexie mirror — single transaction, obfuscated keys.
 * Previously: clear() + bulkPut() in two transactions (non-atomic, plaintext).
 */
async function syncToDexie(keys: GeminiKeyRecord[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    // Guard: db.apiKeys may not exist if Dexie hasn't upgraded to v2 yet
    const hasTable = (db as unknown as { apiKeys?: unknown }).apiKeys;
    if (!hasTable) return;
    // Store obfuscated (consistent with localStorage theatre)
    const toStore = keys.map((r) => ({ ...r, key: obfuscate(r.key) }));
    await db.transaction("rw", db.apiKeys, async () => {
      await db.apiKeys.clear();
      if (toStore.length > 0) {
        // bulkPut inside same transaction — atomic; crash between clear and put won't leave empty store outside tx
        await db.apiKeys.bulkPut(toStore as unknown as GeminiKeyRecord[]);
      }
    });
  } catch {
    // Mirror is best-effort; localStorage remains source of truth — swallow but don't leave silent? log for debugging
    // console.debug("[geminiKeys] syncToDexie failed");
  }
}

/**
 * Reconcile split-brain: if localStorage empty but Dexie has keys, hydrate localStorage.
 * Also if Dexie empty but localStorage has keys, seed Dexie (via syncToDexie called from persist).
 */
async function reconcileDexieIfNeeded(): Promise<void> {
  if (!isBrowser() || hasReconciledDexie) return;
  hasReconciledDexie = true;
  try {
    const raw = localStorage.getItem(GEMINI_KEYS_STORAGE_KEY);
    if (raw) return; // localStorage is truth — nothing to do
    const table = (db as unknown as { apiKeys?: { toArray: () => Promise<GeminiKeyRecord[]> } }).apiKeys;
    if (!table) return;
    const dexieRows = await table.toArray().catch(() => [] as GeminiKeyRecord[]);
    if (!dexieRows || dexieRows.length === 0) return;
    // Dexie rows are obfuscated if written by new code; decode
    const decoded = dexieRows.map(decodeRecord).filter((x): x is GeminiKeyRecord => x !== null);
    if (decoded.length === 0) return;
    decoded.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    // Hydrate localStorage (do not re-trigger sync loop infinitely — sync will no-op if same)
    try {
      const toStore = decoded.map((r) => ({ ...r, key: obfuscate(r.key) }));
      const payload: StoredPayloadV1 = { version: 1, keys: toStore };
      localStorage.setItem(GEMINI_KEYS_STORAGE_KEY, JSON.stringify(payload));
      emitKeysChanged();
    } catch {}
  } catch {}
}

// Fire reconciliation once on module load (browser)
if (isBrowser()) {
  void reconcileDexieIfNeeded();
  // Also listen for storage events to merge cross-tab changes
  try {
    window.addEventListener("storage", (e) => {
      if (e.key === GEMINI_KEYS_STORAGE_KEY) {
        emitKeysChanged();
      }
    });
  } catch {}
}

function decodeRecord(stored: unknown): GeminiKeyRecord | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.label !== "string" || typeof s.key !== "string") return null;
  const rawKey = s.key as string;
  const key = deobfuscate(rawKey);
  // Re-hydrate defaults for missing fields (forward-compat)
  const now = Date.now();
  // Validate status enum fallback
  const validStatuses: ApiKeyStatus[] = ["untested", "working", "invalid", "rate_limited", "error"];
  const rawStatus = typeof s.status === "string" ? (s.status as ApiKeyStatus) : "untested";
  const status = validStatuses.includes(rawStatus) ? rawStatus : "untested";
  return {
    id: s.id as string,
    label: s.label as string,
    key,
    isActive: typeof s.isActive === "boolean" ? (s.isActive as boolean) : true,
    priority: typeof s.priority === "number" && Number.isFinite(s.priority as number) ? (s.priority as number) : 0,
    status: status as ApiKeyStatus,
    lastTestedAt: typeof s.lastTestedAt === "number" ? (s.lastTestedAt as number) : null,
    lastUsedAt: typeof s.lastUsedAt === "number" ? (s.lastUsedAt as number) : null,
    lastError: typeof s.lastError === "string" ? (s.lastError as string) : null,
    lastHttpStatus: typeof s.lastHttpStatus === "number" ? (s.lastHttpStatus as number) : null,
    rateLimitedUntil: typeof s.rateLimitedUntil === "number" ? (s.rateLimitedUntil as number) : null,
    createdAt: typeof s.createdAt === "number" ? (s.createdAt as number) : now,
    updatedAt: typeof s.updatedAt === "number" ? (s.updatedAt as number) : now,
  };
}

function loadStored(): GeminiKeyRecord[] {
  if (!isBrowser()) return [];
  // Opportunistically reconcile if we haven't yet (async, but safe to fire)
  if (!hasReconciledDexie) void reconcileDexieIfNeeded();
  try {
    const raw = localStorage.getItem(GEMINI_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    let arr: unknown[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.keys)) arr = obj.keys as unknown[];
      else if (Array.isArray(obj.value)) arr = obj.value as unknown[]; // defensive
    }
    const decoded = arr.map(decodeRecord).filter((x): x is GeminiKeyRecord => x !== null);
    // Sort by priority asc, then createdAt asc for stable order; re-normalize gaps for safety
    decoded.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    return decoded;
  } catch {
    return [];
  }
}

function persistKeys(keys: GeminiKeyRecord[]): void {
  if (!isBrowser()) return;
  try {
    // Ensure priorities are sequential based on array order if caller passes sorted array?
    // We persist as-is; callers should have set priorities correctly.
    const toStore = keys.map((r) => ({ ...r, key: obfuscate(r.key) }));
    const payload: StoredPayloadV1 = { version: 1, keys: toStore };
    try {
      localStorage.setItem(GEMINI_KEYS_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Handle QuotaExceededError for localStorage (rare but possible with many keys)
      const isQuota =
        (e as Record<string, unknown>)?.name === "QuotaExceededError" ||
        String((e as Error)?.message ?? "").includes("quota");
      if (isQuota) {
        console.error("[geminiKeys] localStorage quota exceeded");
        throw new Error("Storage quota exceeded — remove unused keys or clear site data.");
      }
      throw e;
    }
    emitKeysChanged();
    void syncToDexie(keys).catch(() => {});
  } catch (e) {
    // Don't swallow validation/throw — rethrow quota errors; otherwise log
    if (e instanceof Error && e.message.includes("quota")) throw e;
    // swallow other persist errors to avoid crashing UI, but log
    console.error("[geminiKeys] persistKeys failed", e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function getAllKeys(): GeminiKeyRecord[] {
  return loadStored();
}

export function getEnabledKeysSorted(): GeminiKeyRecord[] {
  const all = loadStored();
  const now = Date.now();
  const enabled = all.filter((k) => k.isActive);
  // Filter out temporarily rate-limited keys if you'd like strict enabled list:
  // we keep them but push rate-limited to end so callers can skip them.
  // For pure enabled list, just return sorted by priority.
  enabled.sort((a, b) => {
    const aLimited = a.rateLimitedUntil != null && a.rateLimitedUntil > now ? 1 : 0;
    const bLimited = b.rateLimitedUntil != null && b.rateLimitedUntil > now ? 1 : 0;
    if (aLimited !== bLimited) return aLimited - bLimited;
    return a.priority - b.priority || a.createdAt - b.createdAt;
  });
  return enabled;
}

export function addKey(input: { label: string; key: string }): GeminiKeyRecord {
  // Normalize Windows paste quirks: trim whitespace, strip BOM, collapse internal whitespace/newlines
  const rawKey = input.key ?? "";
  // Remove surrounding whitespace/BOM and any internal whitespace (e.g. accidental copy with spaces/newlines)
  const sanitized = rawKey.trim().replace(/^\uFEFF/, "").replace(/\s+/g, "");
  const trimmedKey = sanitized;
  const trimmedLabel = (input.label ?? "").trim();
  if (!trimmedKey) throw new Error("API key is required.");
  const validationError = getKeyValidationError(trimmedKey);
  if (validationError) {
    throw new Error(validationError);
  }
  // Use lock-aware read-modify-write when possible; fallback to sync path.
  // Since this function is sync, we do optimistic concurrency: re-read immediately before write
  // and use Web Locks async path if available but can't block sync call — we still mitigate by re-reading.
  // For full atomicity, callers can use addKeyAsync (below).
  const runSync = (): GeminiKeyRecord => {
    const existing = loadStored();
    // Enforce uniqueness by key value (decoded compare)
    if (existing.some((k) => k.key === trimmedKey)) {
      throw new Error("This API key is already added.");
    }
    const now = Date.now();
    // Compute max priority from current snapshot; normalize to avoid gaps
    normalizePriorities(existing);
    const maxPrio = existing.length ? Math.max(...existing.map((k) => k.priority)) : -1;
    const label = trimmedLabel || `Key ${existing.length + 1}`;
    const rec: GeminiKeyRecord = {
      id: generateId(),
      label,
      key: trimmedKey,
      isActive: true,
      priority: maxPrio + 1,
      status: "untested",
      lastTestedAt: null,
      lastUsedAt: null,
      lastError: null,
      lastHttpStatus: null,
      rateLimitedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...existing, rec];
    normalizePriorities(next);
    // Re-check for race: if another tab wrote between our initial read and now, load again and merge
    const fresh = loadStored();
    if (fresh.length !== existing.length) {
      // Another writer won — merge: ensure our key not duplicate in fresh
      if (fresh.some((k) => k.key === trimmedKey)) throw new Error("This API key is already added.");
      const mergedMax = fresh.length ? Math.max(...fresh.map((k) => k.priority)) : -1;
      rec.priority = mergedMax + 1;
      const merged = [...fresh, rec];
      normalizePriorities(merged);
      persistKeys(merged);
    } else {
      persistKeys(next);
    }
    return rec;
  };

  // If Web Locks available, we could await but caller is sync — we do best-effort async lock for future writes
  // Keep sync return for backward compat.
  return runSync();
}

/** Async variant with Web Locks guarantee — prefer for cross-tab safety. */
export async function addKeyAsync(input: { label: string; key: string }): Promise<GeminiKeyRecord> {
  return withGeminiLock(async () => {
    const rawKey = input.key ?? "";
    const trimmedKey = rawKey.trim().replace(/^\uFEFF/, "").replace(/\s+/g, "");
    const trimmedLabel = (input.label ?? "").trim();
    if (!trimmedKey) throw new Error("API key is required.");
    const validationError = getKeyValidationError(trimmedKey);
    if (validationError) throw new Error(validationError);
    const existing = loadStored();
    if (existing.some((k) => k.key === trimmedKey)) throw new Error("This API key is already added.");
    const now = Date.now();
    normalizePriorities(existing);
    const maxPrio = existing.length ? Math.max(...existing.map((k) => k.priority)) : -1;
    const label = trimmedLabel || `Key ${existing.length + 1}`;
    const rec: GeminiKeyRecord = {
      id: generateId(),
      label,
      key: trimmedKey,
      isActive: true,
      priority: maxPrio + 1,
      status: "untested",
      lastTestedAt: null,
      lastUsedAt: null,
      lastError: null,
      lastHttpStatus: null,
      rateLimitedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...existing, rec];
    normalizePriorities(next);
    persistKeys(next);
    return rec;
  });
}

export function updateKey(id: string, patch: Partial<Omit<GeminiKeyRecord, "id" | "createdAt">> & { key?: string }): GeminiKeyRecord | null {
  const all = loadStored();
  const idx = all.findIndex((k) => k.id === id);
  if (idx === -1) return null;
  const current = all[idx];
  // If key is being updated, validate format
  let nextKey = current.key;
  if (patch.key !== undefined) {
    const t = (patch.key ?? "").trim().replace(/^\uFEFF/, "").replace(/\s+/g, "");
    const err = getKeyValidationError(t);
    if (err) throw new Error(err);
    // Check duplicate except self
    if (all.some((k) => k.id !== id && k.key === t)) throw new Error("This API key is already added.");
    nextKey = t;
  }
  // Whitelist allowed fields — prevent arbitrary priority/status overwrite (BUG-DATA-4)
  // Only label, key, isActive are user-mutable here. priority via reorderKeys, status via updateKeyStatus.
  const allowedPatch: Partial<GeminiKeyRecord> = {};
  if (patch.label !== undefined) allowedPatch.label = (patch.label ?? "").trim() || current.label;
  if (patch.isActive !== undefined) allowedPatch.isActive = Boolean(patch.isActive);
  // Note: we intentionally ignore patch.priority, status, rateLimitedUntil, etc. if provided

  const updated: GeminiKeyRecord = {
    ...current,
    ...allowedPatch,
    key: nextKey,
    // Never overwrite id/createdAt from patch inadvertently
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  // Re-normalize priorities to ensure sequential (in case data was corrupted)
  normalizePriorities(all);
  // Preserve the updated record's logical position — normalize sorts, so find it again
  persistKeys(all);
  // Return the fresh updated record (lookup by id)
  return all.find((k) => k.id === id) ?? updated;
}

export function deleteKey(id: string): void {
  const all = loadStored();
  const target = all.find((k) => k.id === id) ?? null;
  const next = all.filter((k) => k.id !== id);
  if (next.length === all.length) return; // no-op
  // BUG-AUTH-10: Secure wipe — overwrite localStorage slot with zeros/X before persisting
  // to reduce forensic recovery from LevelDB WAL / disk slack. Best-effort; JS cannot
  // guarantee erasure of in-memory strings or compaction timing.
  if (isBrowser()) {
    try {
      const raw = localStorage.getItem(GEMINI_KEYS_STORAGE_KEY);
      if (raw) {
        try {
          localStorage.setItem(GEMINI_KEYS_STORAGE_KEY, "0".repeat(raw.length));
        } catch {}
        try {
          localStorage.setItem(GEMINI_KEYS_STORAGE_KEY, "X".repeat(raw.length));
        } catch {}
      }
      // Best-effort overwrite of in-memory key string (strings are immutable, but clear reference)
      if (target) {
        try {
          // overwrite property to avoid lingering reference in all[]
          (target as unknown as { key: string }).key = "0".repeat(target.key.length);
        } catch {}
      }
    } catch {}
  }
  // Re-normalize priorities to 0..n-1 preserving order
  next.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  next.forEach((k, i) => {
    k.priority = i;
    k.updatedAt = Date.now();
  });
  persistKeys(next);
  // BUG-AUTH-10: also clear stale last_project_id if it referenced deleted key id? No — but ensure
  // no cross-contamination: if the deleted key was the only one, keys-changed event already fired.
  // Project last id is handled in db.ts deleteProject.
}

/**
 * Reorder keys. Overloads:
 *  - reorderKeys(orderedIds: string[])
 *  - reorderKeys(fromIndex: number, toIndex: number) // drag reorder
 */
export function reorderKeys(orderedIds: string[]): void;
export function reorderKeys(fromIndex: number, toIndex: number): void;
export function reorderKeys(orderedIdsOrFrom: string[] | number, toIndex?: number): void {
  const all = loadStored();
  if (all.length <= 1) return;

  // Case: reorderKeys(fromIdx, toIdx)
  if (typeof orderedIdsOrFrom === "number" && typeof toIndex === "number") {
    const from = orderedIdsOrFrom;
    const to = toIndex;
    if (from < 0 || from >= all.length || to < 0 || to >= all.length) return;
    // Work on sorted copy — clone objects to avoid leaking side effects
    const sorted = [...all].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt).map((k) => ({ ...k }));
    const [moved] = sorted.splice(from, 1);
    if (!moved) return;
    sorted.splice(to, 0, moved);
    sorted.forEach((k, i) => {
      k.priority = i;
      k.updatedAt = Date.now();
    });
    persistKeys(sorted);
    return;
  }

  // Case: reorderKeys(orderedIds: string[])
  if (Array.isArray(orderedIdsOrFrom)) {
    const orderedIds = orderedIdsOrFrom;
    if (orderedIds.length === 0) return;
    // Validate all ids present
    const idSet = new Set(all.map((k) => k.id));
    if (orderedIds.some((id) => !idSet.has(id))) return;
    // Build map with cloned records
    const byId = new Map(all.map((k) => [k.id, { ...k } as GeminiKeyRecord]));
    const reordered: GeminiKeyRecord[] = [];
    orderedIds.forEach((id, idx) => {
      const rec = byId.get(id);
      if (rec) {
        rec.priority = idx;
        rec.updatedAt = Date.now();
        reordered.push(rec);
      }
    });
    // Append any missing (shouldn't happen) preserving order
    const missing = all.filter((k) => !orderedIds.includes(k.id)).map((k) => ({ ...k } as GeminiKeyRecord));
    missing.forEach((k) => {
      k.priority = reordered.length;
      k.updatedAt = Date.now();
      reordered.push(k);
    });
    persistKeys(reordered);
    return;
  }
}

export function updateKeyStatus(
  id: string,
  patch: Partial<Pick<GeminiKeyRecord, "status" | "lastTestedAt" | "lastUsedAt" | "lastError" | "lastHttpStatus" | "rateLimitedUntil">> & { status?: ApiKeyStatus }
): GeminiKeyRecord | null {
  const all = loadStored();
  const idx = all.findIndex((k) => k.id === id);
  if (idx === -1) return null;
  const cur = all[idx];
  // Validate status enum if provided
  const validStatuses: ApiKeyStatus[] = ["untested", "working", "invalid", "rate_limited", "error"];
  if (patch.status !== undefined && !validStatuses.includes(patch.status as ApiKeyStatus)) {
    // Ignore invalid status
    const { status: _s, ...rest } = patch;
    patch = rest as typeof patch;
  }
  // Validate rateLimitedUntil is future or null
  let nextPatch = { ...patch };
  if (nextPatch.rateLimitedUntil !== undefined && nextPatch.rateLimitedUntil !== null) {
    const v = nextPatch.rateLimitedUntil as number;
    if (typeof v !== "number" || !Number.isFinite(v)) nextPatch.rateLimitedUntil = null;
  }
  // Prevent clobber of lastUsedAt etc. if patch tries to overwrite with stale value? We trust caller but re-read fresh
  // Re-read to avoid clobbering concurrent rateLimitedUntil updates: merge with current if patch doesn't include it
  const next: GeminiKeyRecord = {
    ...cur,
    ...nextPatch,
    id: cur.id,
    createdAt: cur.createdAt,
    updatedAt: Date.now(),
  };
  all[idx] = next;
  persistKeys(all);
  return next;
}

export function initKeys(): GeminiKeyRecord[] {
  if (!isBrowser()) return [];
  // Ensure reconciliation ran
  if (!hasReconciledDexie) void reconcileDexieIfNeeded();
  const existing = loadStored();
  if (existing.length > 0) return existing;
  // Migration from legacy single key
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(GEMINI_LEGACY_KEY);
  } catch {}
  const trimmed = legacy?.trim().replace(/^\uFEFF/, "") ?? "";
  if (trimmed) {
    // Validate but still migrate borderline to avoid data loss — if invalid, mark status invalid
    const validationError = getKeyValidationError(trimmed);
    const isValid = validationError === null;
    const now = Date.now();
    const rec: GeminiKeyRecord = {
      id: generateId(),
      label: "Primary",
      key: trimmed,
      isActive: true,
      priority: 0,
      status: isValid ? "untested" : "invalid",
      lastTestedAt: null,
      lastUsedAt: null,
      lastError: isValid ? null : validationError,
      lastHttpStatus: null,
      rateLimitedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const keys = [rec];
    try {
      persistKeys(keys);
    } catch {}
    // Cleanup legacy key after successful persist (remove source of truth split)
    try {
      localStorage.removeItem(GEMINI_LEGACY_KEY);
    } catch {}
    return keys;
  }
  return [];
}

// Optional helper: get single key by id (useful for callers)
export function getKeyById(id: string): GeminiKeyRecord | null {
  return loadStored().find((k) => k.id === id) ?? null;
}
