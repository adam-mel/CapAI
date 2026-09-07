# Stream A — Data Layer Bug Hunt: Dexie, types, geminiKeys, migrations

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`
**Scope:** `src/lib/db.ts`, `src/lib/types.ts`, `src/lib/geminiKeys.ts`, `src/lib/gemini.ts`, `src/context/EditorContext.tsx`, `src/hooks/useProjects.ts`, `src/app/projects/[id]/processing/ProcessingClient.tsx`, migrations (*none*), generated types
**Date:** 2026-09-07
**Mode:** read-only — no fixes applied

---

## [BUG-DATA-1] Dexie mirror does non-atomic clear + bulkPut and stores plaintext keys

- **File:** `src/lib/geminiKeys.ts`, lines 180-191
- **Severity:** High
- **Category:** Security / Data
- **Description:** `syncToDexie` does `await table.clear(); if (keys.length>0) await table.bulkPut(keys)` with two separate IndexedDB transactions. If the tab crashes or `bulkPut` throws between calls, `apiKeys` is left empty — data loss. It is also fire-and-forget from `persistKeys` (`void syncToDexie(keys)` line 250) with a swallowed `catch {}`, so mirror drift is silent. Worse, it writes `GeminiKeyRecord.key` in plaintext, while `localStorage` stores `btoa(key)` obfuscated. Dexie therefore expands attack surface: any XSS that can read IndexedDB gets raw keys without even base64 decoding.
- **Impact:** Inter-tab crash leaves apiKeys store wiped until next `persistKeys`; plaintext in Dexie makes `btoa` obfuscation theatre. No code ever reads Dexie apiKeys (`getAllKeys`/`getEnabledKeysSorted` read `localStorage` only), so the mirror is dead code that only adds exposure.
- **Suggested Fix:** Remove Dexie mirror or make it transactional: `db.transaction('rw', db.apiKeys, async () => { await db.apiKeys.clear(); await db.apiKeys.bulkPut(keys); })` and either await it or store obfuscated. If mirror is kept, reconcile on load (if localStorage empty but Dexie has data, hydrate).
- **Reproduction:** Add 2 keys, throttle CPU, kill tab mid `syncToDexie` between clear and bulkPut (breakpoint on line 186), reopen -> `await db.apiKeys.toArray()` is [] while localStorage still has keys.

---

## [BUG-DATA-2] Cross-tab lost-update race in every geminiKeys CRUD path

- **File:** `src/lib/geminiKeys.ts`, lines 241-252 (`persistKeys`), 276-313 (`addKey`), 316-345 (`updateKey`), 347-358 (`deleteKey`), 366-424 (`reorderKeys`), 426-444 (`updateKeyStatus`)
- **Severity:** High
- **Category:** Logic / Data
- **Description:** All mutators follow `const existing = loadStored(); // read localStorage` -> mutate in memory -> `persistKeys(next)` -> `localStorage.setItem`. No locking, no `storage` event merge, no compare-and-swap. Two tabs that both `getAllKeys()` then `addKey` concurrently will both compute `maxPrio+1` from the same base and the last writer wins, silently dropping the other's key. Same for `deleteKey` + `addKey` interleaving: delete re-normalizes priorities 0..n-1, concurrent add computed old max. `transcribeWithFallback` intensifies this: each attempt calls `updateKeyStatus` which re-reads localStorage, mutates, and writes — concurrent transcriptions in two tabs can clobber `rateLimitedUntil` / `status`.
- **Impact:** Multi-tab users lose keys or see priority corruption; rate-limit backoff discarded, causing thundering retry on same key.
- **Suggested Fix:** Use `localStorage` as single-writer with `BroadcastChannel` or `navigator.locks` (Web Locks API) around read-modify-write, or move source of truth to Dexie with proper transactions and listen to `storage` events to merge.
- **Reproduction:** Open two tabs, in both call `addKey({label:'t', key:'AIza'+'x'.repeat(35)})` with different suffixes within 50ms -> one key missing after reload. Or run `reorderKeys` drag in tab A while `updateKeyStatus` fires in tab B during transcription.

---

## [BUG-DATA-3] `saveProject` / `createProject` do no validation and ignore quota errors

- **File:** `src/lib/db.ts`, lines 36-53
- **Severity:** High
- **Category:** Data
- **Description:** `saveProject(project)` spreads caller object and only overwrites `updatedAt = Date.now()`. It does not ensure `createdAt`, `name`, `videoBlob` size, `thumbnailDataUrl` validity, `settings.wordsPerSegment ∈ {2,3,4,5}`, or `segments` invariants (`startMs < endMs`, sorted). `createProject` does `await db.projects.add(project)` without setting timestamps at all — caller must have set them; if forgotten, `orderBy('updatedAt')` (line 29) sorts `undefined` last/first unpredictably. Neither helper catches `QuotaExceededError` / `AbortError` from storing a 60 MB `Blob` + thumbnail + segments in IndexedDB. Dexie will reject, but callers in `ProcessingClient.tsx` line 258 and `EditorContext.tsx` line 702 do `await db.projects.put(...)` without quota-specific UX — generic catch shows stale error. No `try/catch` in helpers means quota failure bubbles as unhandled rejection.
- **Impact:** Corrupt project can be persisted (empty name, `startMs>endMs`) breaking canvas/ASS rendering later. User with near-full quota (Safari 1GB limit) sees silent failure or generic error, project appears saved but isn't.
- **Suggested Fix:** Validate at persistence boundary: assert `project.id`, `name.trim()`, `createdAt`, `videoBlob.size < quota`, `isValidThumbnailDataUrl` fallback, `wordsPerSegment` clamp. Wrap `put/add` in try/catch that translates `QuotaExceededError` to user-facing toast. Make `createProject` set `createdAt/updatedAt` defaults.
- **Reproduction:** Call `createProject({id:genId(), name:'', videoBlob:new Blob([new Uint8Array(60*1024*1024)]), ...})` in console -> stored with empty name, later `ProjectGrid` renders blank card. Fill storage to quota in Safari then save -> `DOMException: QuotaExceededError` unhandled.

---

## [BUG-DATA-4] `updateKey` allows arbitrary `priority`/`status` overwrite, breaking sequential invariant

- **File:** `src/lib/geminiKeys.ts`, lines 316-345 (esp. 331-339)
- **Severity:** Medium
- **Category:** Logic / Data
- **Description:** `updateKey(id, patch)` does `{...current, ...patch, key: nextKey, id: current.id, ...}` where `patch` is `Partial<Omit<GeminiKeyRecord,'id'|'createdAt'>> & {key?:string}`. Caller can pass `{priority: 999, isActive: false, status: 'working', rateLimitedUntil: 0}` and it will be persisted. No validation that `priority` stays in 0..n-1 or unique, that `status` is in `ApiKeyStatus`, or that `rateLimitedUntil` is future. Later `loadStored` sorts by `priority` but gaps/duplicates remain; `addKey` computes `maxPrio+1` from corrupted set, leaving holes. `deleteKey` re-normalizes, but until then `getEnabledKeysSorted` may return non-deterministic order and `reorderKeys` will produce duplicate priorities.
- **Impact:** Manual `priority: 999` via console or future UI bug creates sparse ordering; drag-reorder after that yields wrong visual order, transcribe tries keys in unexpected order.
- **Suggested Fix:** Whitelist patch keys: pick only `label, key, isActive` in `updateKey`; manage `priority` only via `reorderKeys`; manage `status` only via `updateKeyStatus`. Or validate `priority`: if present, reject or clamp and re-normalize.
- **Reproduction:** `updateKey(id, {priority: 99})` then `getAllKeys()` -> priorities [0,99,2] -> `addKey` next priority 100, gap persists.

---

## [BUG-DATA-5] Legacy single-key migration is incomplete and permissive

- **File:** `src/lib/geminiKeys.ts`, lines 446-479; `src/lib/types.ts`, line 138; `src/app/projects/[id]/processing/ProcessingClient.tsx`, lines 54-70, 180-181
- **Severity:** Medium
- **Category:** Data / Logic
- **Description:** `initKeys` migrates `localStorage.getItem(GEMINI_LEGACY_KEY)` (`capai_gemini_api_key`) into a `GeminiKeyRecord` with `label:'Primary'` if any non-empty trimmed string exists (line 456). It does not validate format via `getKeyValidationError` (comment says migrate even if borderline to avoid data loss), so an invalid legacy key (e.g. 10-char typo) is persisted as `untested` and later `transcribeWithFallback` will try it and fail. It also never removes the legacy key, leaving two sources of truth. Migration is only called in `ProcessingClient` (processing page) and not on dashboard or Settings mount, so a user who never visits processing retains legacy key indefinitely. `hasPendingFile`-style stale read.
- **Impact:** Invalid legacy key pollutes multi-key list, causes extra failed attempt per transcription (adds 180ms delay). Legacy key remains in storage, confusing debugging.
- **Suggested Fix:** Validate migrated key (allow but mark `status:'invalid'` if fails), and `localStorage.removeItem(GEMINI_LEGACY_KEY)` after successful persist. Call `initKeys` at app bootstrap (layout) not just processing.
- **Reproduction:** Set `localStorage.setItem('capai_gemini_api_key','bad')` fresh, load dashboard -> `getAllKeys()` still [] (migration not run). Go to processing -> now `getAllKeys()` has invalid key. Reload dashboard -> still has it but legacy key still exists.

---

## [BUG-DATA-6] `reorderKeys` variadic overload uses `arguments` object — fragile and untyped

- **File:** `src/lib/geminiKeys.ts`, lines 366-424 (esp. 388-396)
- **Severity:** Medium
- **Category:** Logic / Type
- **Description:** Signature is `reorderKeys(orderedIdsOrFrom: string[] | string | number, toIndex?: number)` but body handles `reorderKeys('id1','id2',...)` by doing `Array.from(arguments).filter(x=>typeof x==='string')` (line 395). In strict TS / ES modules `arguments` is not typed and arrow callers would break; TypeScript callers see error if they try spread. If called as `reorderKeys('singleId')` with one string, it treats as variadic list of 1, not as array, and proceeds to reorder to single-item list — arguably correct but undocumented. If called as `reorderKeys(0, 1)` (drag) it correctly splices, but `all` vs `sorted` shallow-copy mutation (line 376) means `all` objects are mutated before persist, leaking side effects if caller held reference.
- **Impact:** Future refactor to arrow function or bundler that transpiles `arguments` incorrectly breaks reorder. Type drift: callers cannot safely use spread.
- **Suggested Fix:** Provide explicit overloads: `reorderKeys(orderedIds: string[])` and `reorderKeys(from:number,to:number)` with separate implementations; remove `arguments` usage, use rest param `...ids: string[]`.
- **Reproduction:** `reorderKeys('a','b','c')` in console works but `tsc --noEmit` shows overload mismatch; after bundling with `use strict`, `Array.from(arguments)` inside arrow wrapper fails.

---

## [BUG-DATA-7] API key storage is base64 obfuscation, not encryption — XSS exfiltrates plaintext from Dexie

- **File:** `src/lib/geminiKeys.ts`, lines 122-160 (`obfuscate`/`deobfuscate`), 241-250 (`persistKeys`), `src/lib/types.ts`, lines 105-119
- **Severity:** High
- **Category:** Security
- **Description:** `obfuscate` is `btoa(key)` (or Buffer base64) — reversible by any script. `deobfuscate` detects raw vs btoa by prefix `AIza`/`AQ.`, trivial to reverse. Keys are persisted to `localStorage` (`capai_gemini_api_keys`) as btoa and to Dexie `apiKeys` as plaintext (see BUG-DATA-1). This is a local-first app with no server, so storage is expected, but there is no `httpOnly` alternative, no in-memory-only option, and no warning that any XSS or extension can steal keys. No RLS / server-side proxy — Gemini key is exposed to browser and sent directly to `generativelanguage.googleapis.com` from client (`src/lib/gemini.ts` lines 301, 583). `getKeyValidationError` is permissive (20-200 chars) to allow future formats, but does not rate-limit local reads.
- **Impact:** Compromised dependency or injected script can `localStorage.getItem` + `atob` or `db.apiKeys.toArray()` and exfiltrate all Gemini keys. User may paste production-billed key thinking it's safe locally.
- **Suggested Fix:** Document threat model, consider encrypting at rest with WebCrypto `subtle.encrypt` using a user passphrase or at least not mirroring to Dexie. Offer memory-only mode. Add CSP to mitigate XSS. For high-value keys, proxy through a serverless function instead of client-side fetch.
- **Reproduction:** In DevTools console: `JSON.parse(localStorage.getItem('capai_gemini_api_keys')).keys.map(k=>atob(k.key))` -> raw keys. Or `await db.apiKeys.toArray()` -> plaintext.

---

## [BUG-DATA-8] Source-of-truth split: localStorage is truth, Dexie is stale mirror never read

- **File:** `src/lib/geminiKeys.ts`, lines 180-191, 241-252, 256-258, 260-274; `src/lib/db.ts`, lines 18-20
- **Severity:** Medium
- **Category:** Data / Logic
- **Description:** `loadStored` reads only `localStorage`; `getAllKeys`/`getEnabledKeysSorted` never consult Dexie. `syncToDexie` is best-effort and swallows errors, so Dexie can be empty/stale while app functions. Conversely, if `localStorage` is cleared (user clears site data) but Dexie remains, keys are lost with no recovery — Dexie has them but app ignores. Dexie `apiKeys` table has indexes `id, priority, isActive` but no query ever uses them. The version 2 migration adds `apiKeys` store but no upgrade function to seed it from existing localStorage (only future writes sync).
- **Impact:** Users who clear localStorage expect keys still in IndexedDB but they vanish; or after a failed `syncToDexie` (quota), Dexie empty while localStorage has keys — inconsistent backup. Dead Dexie store bloats version history for no benefit.
- **Suggested Fix:** Make Dexie the source of truth and remove localStorage, or keep localStorage but remove Dexie mirror, or implement reconciliation on startup: if localStorage empty and Dexie has keys, hydrate localStorage; if Dexie empty and localStorage has keys, seed Dexie transactionally.
- **Reproduction:** Add key, then `localStorage.removeItem('capai_gemini_api_keys')` -> reload -> `getAllKeys()` [] even though `await db.apiKeys.toArray()` still has key.

---

## [BUG-DATA-9] Auto-save `beforeunload` handler fires async Dexie update that may abort

- **File:** `src/context/EditorContext.tsx`, lines 699-736 (esp. 723-736)
- **Severity:** Medium
- **Category:** Data
- **Description:** `useEffect` handler for `beforeunload` does `void db.projects.update(project.id, {segments, captionStyle, settings, updatedAt: Date.now()})` without awaiting. IndexedDB transactions are aborted when the page unloads; `void` means the browser may terminate before the transaction commits. The main debounced save (line 699, 800ms) also clears timeout on unmount but does not flush. User who edits then immediately closes tab may lose last 800ms+ of edits. No `navigator.sendBeacon` or synchronous fallback, and `updatedAt` is set to unload time, not edit time.
- **Impact:** Data loss on fast close; especially for 75-seg projects where user splits/merges then closes.
- **Suggested Fix:** In `beforeunload`, use `event.preventDefault()` + synchronous `localStorage` staging, or `navigator.sendBeacon` to a service worker that writes Dexie, or flush debounced save synchronously via `await` before unload (use `pagehide` + keepalive).
- **Reproduction:** Edit segment text, immediately close tab within 500ms -> reopen project -> last edit missing, `updatedAt` not bumped.

---

## [BUG-DATA-10] `useProjects.renameProject` non-atomic fallback can resurrect deleted project

- **File:** `src/hooks/useProjects.ts`, lines 40-54
- **Severity:** Medium
- **Category:** Logic / Data
- **Description:** `renameProject` does `const updated = await db.projects.update(id, {name, updatedAt}); if (updated===0) { const existing = await db.projects.get(id); if (existing) await db.projects.put({...existing, name, updatedAt}) }`. `Dexie.update` returns 0 if key not found OR if no keys changed? (implementation returns 0 when not found). The fallback `get`+`put` is non-atomic: between `update` returning 0 and `get`, another tab could have deleted the project — `get` returns undefined and fallback no-ops (correct), but between `get` and `put`, another tab could recreate a project with same id (unlikely but possible with `uuid` collision) or modify segments, which `put` would overwrite with stale `existing` snapshot. Also `update` with same name no-ops? Not handled.
- **Impact:** Stale overwrite: rename based on stale read discards concurrent segment edits.
- **Suggested Fix:** Use single `put` with current Dexie record read inside a transaction: `db.transaction('rw', db.projects, async () => { const p=await db.projects.get(id); if(!p) return; p.name=trimmed; p.updatedAt=Date.now(); await db.projects.put(p); })`.
- **Reproduction:** Open project in two tabs, in tab A rename, in tab B edit segments (auto-save), then in tab A rename again quickly -> B's segment edits may be overwritten by A's stale `existing` read.

---

## [BUG-DATA-11] No SQL migrations directory — Dexie versioning is implicit and lacks upgrade hooks

- **File:** `src/lib/db.ts`, lines 13-21; repo root (no `migrations/`)
- **Severity:** Low
- **Category:** Data / Type
- **Description:** Project was scaffolded to check `migrations` but repo has none (verified `glob **/*.sql` and `**/migrations/**` empty). Schema lives only in `CapAIDatabase` class with two `this.version(n).stores` calls. There is no explicit upgrade function to backfill new fields (e.g., adding `apiKeys` did not backfill `priority` for existing projects, nor migrate `thumbnailDataUrl` truncation). Dexie requires declaring all indexes per version; current code declares `projects: 'id, name, createdAt, updatedAt'` only in v1, and `apiKeys: 'id, priority, isActive'` only in v2 — fresh install (no existing DB) creates via latest version, but Dexie merges stores implicitly; behavior is correct but not documented, and future v3 that needs to add index to `projects` must redeclare `projects` string or it will be dropped. No `pgTAP`/DB tests, no `pnpm test:db` target in `package.json` scripts.
- **Impact:** Future schema change risks silent index loss; no migration tests to catch drift. Auditors expecting `migrations/` find none — confusion.
- **Suggested Fix:** Add explicit `export const DB_VERSION = 2` comment, include upgrade hooks: `this.version(2).stores({...}).upgrade(tx=> tx.table('projects').toCollection().modify(...))` for backfills. Add a `migrations/README.md` explaining Dexie vs SQL.
- **Reproduction:** Add v3 that adds `projects: 'id, *name'` but forgets to redeclare `apiKeys` -> new users lose `apiKeys` table.

---

## [BUG-DATA-12] Type drift: `Project` stores `Blob` + unvalidated `thumbnailDataUrl` with no constraints

- **File:** `src/lib/types.ts`, lines 8-19, 14; `src/lib/db.ts`, lines 56-76; `src/lib/thumbnail.ts`, lines 134-195
- **Severity:** Medium
- **Category:** Data / Type
- **Description:** `Project.thumbnailDataUrl: string` is typed as plain string, but valid values are either `data:image/jpeg;base64,...` 1k-500k or `data:image/svg+xml,...` placeholder. `isValidThumbnailDataUrl` / `sanitizeThumbnailDataUrl` enforce 1000< length <500000 and prefix checks, but `saveProject`/`createProject` never call them, and IndexedDB has no `CHECK` constraint. A truncated JPEG (e.g., 400 chars due to storage failure) can be persisted, later `ProjectCard` will try to render and hit `ERR_INVALID_URL`. Similarly `settings.wordsPerSegment: 2|3|4|5` is a union, but `groupWordsIntoSegments` clamps `Math.max(1,Math.min(5,Math.floor(wordsPerSegment)))`, silently accepting 1 or 5. No DB-level validation. `Project.videoBlob: Blob` is stored via structured clone, but TypeScript `Table<Project,string>` does not enforce that `id` is UUID v4 nor that `createdAt/updatedAt` are numbers.
- **Impact:** Corrupt thumbnails stored -> broken dashboard cards, hard to debug. Invalid `wordsPerSegment` 1 produces single-word segments, breaking PRD grouping. Type system allows `thumbnailDataUrl = 'not-a-data-url'` to compile.
- **Suggested Fix:** Add persistence guard: in `saveProject`/`createProject` call `sanitizeThumbnailDataUrl` and replace invalid with `placeholderThumbnail()`. Add branded type `type ThumbnailDataUrl = \data:image/jpeg;base64,\\ | \data:image/svg+xml\\` or Zod schema. Add Dexie hook `db.projects.hook('creating', ...)` to validate.
- **Reproduction:** `await db.projects.put({...project, thumbnailDataUrl: 'data:image/jpeg;base64,/9j/'})` succeeds, reload dashboard -> console `Failed to load image` and broken card. Or set `settings.wordsPerSegment = 1 as any` -> segments of 1 word, export still works but UI shows unexpected grouping.

---

## [VERIFY] Dexie fresh-install schema inheritance assumed

- **File:** `src/lib/db.ts`, lines 13-21
- **Severity:** Low
- **Category:** Data
- **Description:** Flagged as [VERIFY] because Dexie docs state unspecified stores are preserved, but fresh-install behavior (DB does not exist, version 2 applied directly) should be verified by deleting `capai_db` in DevTools -> Application -> IndexedDB and reloading, then inspecting `db.projects` and `db.apiKeys` exist and have correct indexes. No automated test covers this.
- **Suggested Fix:** Add integration test that opens DB with `Dexie.delete` then asserts both tables exist.

---

*Read-only scan — no files modified. Verified via static read of `src/lib/db.ts` (76 lines), `src/lib/types.ts` (138 lines), `src/lib/geminiKeys.ts` (484 lines), `src/lib/gemini.ts` (748 lines), `src/context/EditorContext.tsx` (857 lines), `src/hooks/useProjects.ts` (58 lines), and repo glob for migrations/sql (0 results).*
