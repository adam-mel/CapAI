# Stream E — Test Suite Bug Hunt: Unit / Integration / e2e / DB

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`
**Scope:** test suites, test configuration, mocks, fixtures, factories, coverage settings
**Date:** 2026-09-07 (read-only)
**Method:** glob search `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `e2e/**`, `tests/**`, `playwright.config.*`, `vitest.config.*`, `jest.config.*`, `coverage` + `package.json` scripts + `src/` manual inspection. `npx tsc --noEmit` GREEN (verified via `tsc_verify.log`). No vitest/jest/playwright test run — no runnable suite.
**Inventory:** **0 project-owned test files** (all hits are `node_modules`). See Finding BUG-TEST-1.

> READ-ONLY — no fixes applied. All file:line are exact.

---

## Summary

CapAI has **no test framework installed and no tests written**. `package.json` exposes only `dev/build/start/lint` (line 5-9). `playwright@1.63.0` is in `devDependencies` but `playwright.config.ts` is absent and `package.json` has no `test` script, so `npx playwright test` exits 0 with “No tests found” — false green. `vitest`/`jest` are not installed and no `*.test.*`/`*.spec.*` exists under `src/` (verified via `Get-ChildItem -Recurse` excluding `node_modules`). `temp-e2e/` contains 8 ad-hoc Node/Playwright verifier scripts (`verify-tester.js`, `verify-export*.mjs`, `canvas-burn-verify.mjs`, `wysiwyg-verify.mjs`, `test_ass_*.js`) that the team treats as e2e — they are not CI tests: they never `process.exit(1)` on failure except build, they rely on screenshots/human log grep, they write to `temp-e2e/downloads` and leak IndexedDB state. Result: **entire codebase ships with zero automated coverage** — any green CI badge is vacuous. Critical modules (ASS generation, FFmpeg export pipeline, canvas WYSIWYG, `getVideoMetadata` dims, Dexie migrations, Gemini key rotation) have 0% unit coverage and no integration contract tests. Existing verifier mocks silently resolve `null` / empty results and pin buggy behavior (old 12-120 font clamp, 80 ms gap, `fontsdir` outside quotes).

---

## [BUG-TEST-1] No test framework, no tests — entire suite is vacuous (Critical false-green)

- **File:** `package.json`, lines 5-9; `tsconfig.json` lines 25-33; repo root (no `playwright.config.*`, no `vitest.config.*`, no `jest.config.*`, no `__tests__`)
- **Severity:** Critical
- **Category:** Tests
- **Description:** `package.json` scripts = `{ dev, build, start, lint }` — no `test`, `test:unit`, `test:e2e`, `coverage`. `devDependencies` contains `playwright@1.63.0` but no config file, no `tests/` or `e2e/` folder (aside from `temp-e2e/` unverified). Glob `src/**/*.test.*` and `src/**/*.spec.*` return 0 hits outside `node_modules`. `Get-ChildItem -Recurse | Where-Object Name -match "test|spec"` over `src/` yields only stray string matches (`formatDuration` etc.) — no test files. `tsc_verify.log` is clean but `tsc --noEmit` is not a test. CI that runs `npx playwright test` will report “No tests found” and exit 0 — widely believed green covers nothing. Coverage collection is unconfigured: no `vitest --coverage`, no `c8`, no `istanbul`, no `collectCoverageFrom`. The team’s `verify-tester.js` / `final-local-verify.mjs` are manual one-offs invoked by a developer, not a test suite — they are not listed in `package.json`, not run in CI, not deterministic.
- **Impact:** All logic bugs found in Streams A-D (ASS PlayRes, fontsdir, canvas overlay, Dexie migration) ship uncaught. A regression that breaks export (`ass` filter missing) would still be “green.” Build + tsc is the only gate.
- **Suggested Fix:** Install `vitest` + `jsdom` + `@testing-library/react` + `playwright/test` with `playwright.config.ts` (webServer `next dev`, `projects` per browser, `testDir: tests/e2e`). Add `scripts: { "test": "vitest run", "test:e2e": "playwright test", "coverage": "vitest run --coverage" }`. Create `src/__tests__/` and `tests/e2e/` skeletons and wire coverage `include: ["src/lib/**", "src/hooks/**", "src/context/**"]`.
- **Reproduction Steps:** `npm test` → `missing script: test`. `npx playwright test --list` → `No tests found`. `Get-ChildItem src -Recurse -File | Where-Object FullName -like "*.test.*"` → 0.

---

## [BUG-TEST-2] Critical modules excluded from any coverage — auth/RLS/date-bounds/error branches untested

- **File:** `src/lib/assGenerator.ts` lines 145-394; `src/lib/export.ts` lines 62-662; `src/lib/canvasRenderer.ts` lines 137-606; `src/lib/ffmpeg.ts`; `src/lib/gemini.ts`; `src/lib/db.ts` lines 1-57; `src/lib/canvasExport.ts`; `src/lib/parseTranscription.ts`; `src/context/EditorContext.tsx`
- **Severity:** High
- **Category:** Tests
- **Description:** None of these modules have a corresponding test. `assGenerator.generateASS` (PlayRes validation `w<320||h<240` → throw, `ASS_FONT_FALLBACKS` Impact→Arial Black, WYSIWYG scaling `playResX/352`, `marginVFor` bottom 0.16×h, gap 150 ms, pop scale 1.15×) is 0% covered. `export.ts:getVideoMetadata` (8 s timeout, `URL.createObjectURL`, `loadedmetadata` vs `error`, `hasExternal?` branch) and `exportVideo` (fontsdir `/fonts` fetch, `pix_fmt yuv420p`, `-noautorotate`, Dialogue 0 guard, size ±5 KB tolerance) are 0% covered. `canvasRenderer.renderCaption` (WYSIWYG `canvasWidth/352`, DPR, `maxContentWidth 0.88×`, pill 0.08 ghost, RTL regex, downscale `0.45×h`) is 0% covered. `db.ts` Dexie v1→v2 migration and `isValidThumbnailDataUrl` length 1000-500k checks are 0% covered. `gemini.ts` key rotation is 0% covered. No `coverage` config exists to flag these exclusions, so gaps are invisible.
- **Impact:** A single wrong constant (`WYSIWYG_REF_W` 352 vs 320, `MarginV` 0.16 vs 0.12) silently ships. Export failure paths (`getVideoMetadata` reject → ExportModal shows “Could not detect dimensions”) are never exercised — a future catch that swallows will hide.
- **Suggested Fix:** Add unit suites: `assGenerator.test.ts` (30 cases: PlayRes throw, hexToAssColour AA, font fallback, WYSIWYG 352→1080=184, wrap), `export.test.ts` (mock FFmpeg MEMFS), `canvasRenderer.test.ts` (jsdom canvas, DPR 1 vs 2, pill), `db.test.ts` (fake-indexeddb, v1→v2). Enable `coverage: { provider:"v8", thresholds:{ lines:70, branches:60 } }` and fail CI if uncovered.
- **Reproduction Steps:** `grep -R "describe\|it(" src` → no hits outside `src/components/editor/CaptionList.tsx` false positive (contains `it(` inside string split). `vitest --coverage` → not installed.

---

## [BUG-TEST-3] `temp-e2e/test_ass_75.js` pins buggy behavior — assertions encode old 12-120 clamp and 80 ms gap

- **File:** `temp-e2e/test_ass_75.js`, lines 57-62 (fontSize clamp), lines 98-104 (gap 80 ms), line 60 (shadow always 1)
- **Severity:** Medium
- **Category:** Tests
- **Description:** This ad-hoc test mirrors `assGenerator.ts` but with **pre-fix logic**: `fontSize = Math.max(12, Math.min(120, Math.round(style.fontSize||48)))` (line 58) while current `assGenerator.ts` line 187 uses WYSIWYG scaling `rawScaledFontSize = style.fontSize*playResX/352` clamped 10-400 (up to 184 for 1080×1920 Bold 60). Any fix that correctly scales to 184 would break this test’s expected 60 — the test **pins the bug**. Likewise gap threshold is hardcoded 80 ms (line 99 `if(firstWordStart-segStart>80)` ) vs current 150 ms (assGenerator:323), and inactive gap color is always `inactiveAss` (line 100) vs new gold-pop gap fix. The test never fails CI because it’s not run — but if promoted to CI as-is it would block the correct fix.
- **Impact:** Real fix (WYSIWYG) would be reverted to make test green. Reviewer may conclude preview/export mismatch is “expected” because test says 60.
- **Suggested Fix:** Update `test_ass_75.js` to import real `generateASS` (via `tsx` or compiled) and assert `Style: Default,Arial Black,184,...` for 1080×1920 Bold 60, and gap threshold 150 ms. Delete duplicated logic.
- **Reproduction Steps:** `node temp-e2e/test_ass_75.js 2>&1 | grep "Fontsize"` → would show 60 not 184. Compare `src/lib/assGenerator.ts:187` vs `temp-e2e/test_ass_75.js:58`.

---

## [BUG-TEST-4] False-confidence mock: `verify-tester.js` IndexedDB seeder silently resolves on missing store

- **File:** `verify-tester.js`, lines 89-105 (`indexedDB.open('capai_db')` → `if(!db.objectStoreNames.contains('projects')){ resolve({error:'no store'}); }`)
- **Severity:** Medium
- **Category:** Tests
- **Description:** `seedProject()` promises to seed a 7-seg or 75-seg project but on `no store` it **resolves** ` {error:'no store'}` instead of rejecting. Caller at line 149 `const s7 = await seedProject(...); log(JSON.stringify(s7.res))` logs but does not assert — export continues with missing project, later `page.goto(/projects/ID)` shows “No project” (VideoPlayer:398) but verifier still claims `BUILD GREEN ✓` and `Seed projects` PASS. The mock never validates `put` args: it puts raw `videoBlob` via base64→Blob but does not check `Blob.size` (could be 0) and uses a 1×1 jpeg thumb `data:image/jpeg;base64,/9j/...` length ~300 (<1000 fails `isValidThumbnailDataUrl` line 46) yet `sanitizeThumbnailDataUrl` is never exercised. Any real `saveProject` bug (e.g., truncation to 300 bytes) would pass vacuously.
- **Impact:** A DB regression where `projects` store never created (e.g., Dexie `version(2)` blocked) would still be reported “seeded ✓” and later export failure blamed on ffmpeg, not DB.
- **Suggested Fix:** Make seeder `reject` on `no store` and `throw` if `segments.length!==segCount` or `blobSize===0`. Use `expect(res.ok).toBeTruthy()` and `expect(g.result.segments.length).toBe(segCount)`. Seed via real `db.projects.put` via `page.evaluate` importing `dexie`.
- **Reproduction Steps:** Block Dexie upgrade (`indexedDB.deleteDatabase('capai_db')` then open old version with no store) → run `node verify-tester.js` → still logs `7-seg seeded: {"error":"no store"}` and continues.

---

## [BUG-TEST-5] False-confidence mock: `verify-tester.js` and `canvas-burn-verify.mjs` never validate video dimensions argument

- **File:** `verify-tester.js`, lines 32-58 (synthetic segments), `canvas-burn-verify.mjs` lines 32-70, `final-local-verify.mjs` lines 30-45
- **Severity:** Medium
- **Category:** Tests
- **Description:** Seeders fabricate 75 segments with `wordsPer=2+(i%3)`, `t+=e+80` and push to `indexedDB`, but never pass `videoWidth/videoHeight` to project. Later `exportVideo` will call `getVideoMetadata(blob)` to derive dims, but verifiers assert modal shows `1080×1920` (line 252) based on seeded blob’s actual video file (64721171 B MP4) — not on seeder args. If `getVideoMetadata` were mocked to return `null`, the seeder would still PASS because it never asserts `meta.width===1080`. Mocks that never validate received arguments are vacuous — any dims would pass.
- **Impact:** A bug where `getVideoMetadata` returns 1280×720 fallback for vertical (previously warned at `export.ts:96`) would still show `1080×1920` in modal because verifier reads original file, not the mocked path — false confidence.
- **Suggested Fix:** In seeder, after `store.put`, `store.get(id)` and `assert(g.result.videoDims?.w === 1080)` or assert `export.ts` diagnostic log `[export] ASS diagnostics playRes 1080x1920`. Add `expect(fetchFile).toHaveBeenCalledWith(expect.objectContaining({size:64721171}))`.

---

## [BUG-TEST-6] `canvas-burn-verify.mjs` / `wysiwyg-verify.mjs` use hard `waitForTimeout(5000)` polling — non-deterministic ordering

- **File:** `canvas-burn-verify.mjs` lines 140-180; `wysiwyg-verify.mjs` lines 120-180; `verify-tester.js` lines 157-169 (20×1000 poll), lines 270-299 (40×5000)
- **Severity:** Medium
- **Category:** Tests (Test infra)
- **Description:** All verifiers poll with fixed sleeps (`waitForTimeout(1000)` 20×, `5000` 40× up to 200 s) then check `isDone` via `innerText.includes('Done!')`. No `waitForSelector` with timeout, no retry-assertion library. On slow CI (CPU 6×, 60 MB ffmpeg load 30-40 s) the 20 s outer loop may still be loading libass while verifier already screenshotted `verify-portrait-editor.png` at 1.5 s (`page.waitForTimeout(1500)` line 141). Ordering depends on `loadedmetadata` → `getVideoMetadata` → `ffmpeg.load` race; a slow `fontsdir` fetch (Inter TTF 500 KB via raw.githubusercontent) will make `hasFontsdir` log appear after poll loop exits. Shared mutable `consoleLogs[]` array is not reset per-test (verify-tester reuses `consoleLogs.length=0` manually but `canvas-burn` pushes without clearing).
- **Impact:** Flaky green on fast SSD, red on CI. A 75-seg export that finishes at 210 s is marked FAIL because loop is 200 s max. Team disables test instead of fixing timeout.
- **Suggested Fix:** Replace sleeps with `await page.waitForResponse(/ffmpeg-core.wasm/)` and `await expect(page.getByText('Done!')).toBeVisible({timeout: 300_000})` (Playwright web-first). Use `expect.poll`.
- **Reproduction Steps:** Run `node canvas-burn-verify.mjs` on Slow 4G CPU 6× → first poll `export 0%` then `Done` never seen before timeout.

---

## [BUG-TEST-7] Missing scenarios: no tests for race, rollback, RPC failure, boundary dates, custom ranges

- **File:** (absence) `src/lib/export.ts` lines 357-368 (abort), 482-533 (tryExec), 601-608 (size guards); `src/lib/ffmpeg.ts`; `src/lib/parseTranscription.ts`; `src/lib/gemini.ts`; `src/context/EditorContext.tsx` lines 389-395
- **Severity:** Medium
- **Category:** Tests
- **Description:** Zero tests cover: (a) **Race**: concurrent `exportVideo` calls while `exportFFmpeg` singleton loading (`exportLoadPromise` double-load) — no test that two `getExportFFmpeg()` in parallel deduplicate vs race. (b) **Rollback**: `AbortSignal` during `ffmpeg.writeFile` → `resetExportFFmpeg()` → second export should succeed — no abort mid-exec test. (c) **RPC failure / error mapping**: `tryExec` returns code 1 with `No such filter: ass` → fallback to `subtitles` → both fail → should throw “FFmpeg build does not support ASS” — no test for that mapping (export.ts:564). (d) **Boundary dates/times**: `formatAssTime` at `h=0,m=0,s=0,cs=0` vs `h=99:59:59.99` clamp `Math.max(0)` (assGenerator:34) — no test for negative ms or overflow. (e) **Custom ranges**: `wordsPerSegment` 1 vs 10, `positionOffsetY` -50/+50, `fontSize` 10 vs 400 clamp, `shadowBlur` 0 vs 20, `videoWidth 319` (should throw) — all uncovered. `parseTranscription` is referenced but untested (no transcription fixture).
- **Impact:** Abort leaves zombie `/fonts/Inter-Regular.ttf` half-written → next export “fontsdir not found”. Off-by-one in ASS timing (`endMs` clamp +100) not caught.
- **Suggested Fix:** Add matrix tests: `export.abort.spec.ts` (abort before load, during exec, after), `ffmpeg.fallback.spec.ts` (mock `ffmpeg.exec` returning 1 with log), `assGenerator.boundary.spec.ts` (negative, huge, 319×239 throw, 320×240 pass, 75 segs 225 Dialogues), `parseTranscription` with Gemini JSON fixture.
- **Reproduction Steps:** `grep -R "AbortSignal\|tryExec\|formatAssTime" src --include="*.test.*"` → 0.

---

## [BUG-TEST-8] E2e suite requires live stack — marked NOT RUN, verified statically (no isolation)

- **File:** all `temp-e2e/*.mjs`, `verify-tester.js` line 130 (`BASE='http://localhost:3000'`), `canvas-burn-verify.mjs` line 12, `final-local-verify.mjs` line 14
- **Severity:** High
- **Category:** Tests
- **Description:** Playwright verifiers require `next dev` on `http://localhost:3000` with `COOP:same-origin` + `COEP:require-corp` (next.config:8-22) + `SharedArrayBuffer` + IndexedDB `capai_db` + 60 MB video file `temp-e2e/A 30-Day Money Challenge.mp4` (64.7 MB). No `playwright.config.ts` webServer to auto-start dev, no CI artifact for video file (`.gitignore` likely ignores `*.mp4`). The suite cannot run in `npx tsc --noEmit` or offline CI — it is **NOT RUN** per instructions. Static review shows verifiers depend on external GitHub fetch `https://raw.githubusercontent.com/google/fonts/main/...Inter-Regular.ttf` (export.ts:430) which requires CORS — if blocked, export warns but test still PASS because it only checks file-level `fontsdir` string (check_fallback.mjs line 8) not runtime fetch success.
- **Impact:** PR that breaks `next.config` headers still passes `tsc` but e2e is never executed — deployment breaks SharedArrayBuffer silently.
- **Suggested Fix:** Add `playwright.config.ts` with `webServer: { command:"npm run dev", url:"http://localhost:3000", timeout:120000, reuseExistingServer:!process.env.CI }`, `expect` timeout 60s for export, `retries:1` for wasm flake. In CI, vendor `ffmpeg-core.wasm` to `/public/ffmpeg` (already present as `temp-e2e/ffmpeg-core.wasm` 32 MB) so no unpkg fetch; mock font fetch via `page.route`.
- **Reproduction Steps:** `npx playwright test` → `No config`. `dev.log` shows `dev alive` checked manually.

---

## [BUG-TEST-9] DB (Dexie) tests absent — guaranteed-red assertions not run; pgTAP N/A

- **File:** `src/lib/db.ts` lines 5-18 (Dexie v1→v2), `src/types/index.ts`
- **Severity:** High
- **Category:** Tests
- **Description:** No `db.test.ts` exists. No `fake-indexeddb` or `dexie` in-memory test. No `pgTAP` — this project uses Dexie (IndexedDB) not Postgres, so `pgTAP` is N/A but the test requirement per prompt (DB pgTAP) would be marked NOT RUN. Current `db.ts` v2 migration (`apiKeys: "id, priority, isActive"`) has no test that data from v1 (`projects` only) migrates without loss. `deleteProject` soft-delete vs hard-delete not tested. A regression that drops `updatedAt` ordering (`orderBy("updatedAt").reverse()` line 24) would be missed.
- **Impact:** A broken Dexie upgrade that silently drops `projects` on version bump would not be caught — verifier’s `resolve({error:'no store'})` would hide it (see BUG-TEST-4).
- **Suggested Fix:** Add `src/lib/db.test.ts` with `import "fake-indexeddb/auto"`; test `new CapAIDatabase()` v1 then v2 upgrade, `saveProject` preserves `id`, `getAllProjects` sorted desc.
- **Reproduction Steps:** `Get-ChildItem src/lib/db*` → only `db.ts`. Search `*pgTAP*` → 0.

---

## [BUG-TEST-10] Stale tests pinning policies/schema the codebase moved past

- **File:** `temp-e2e/test_ass_fallback.js` lines 1-10; `check_fallback.mjs` lines 1-9; `verify-tester.js` lines 63-87 (style preset Bold Drop)
- **Severity:** Low
- **Category:** Tests
- **Description:** `test_ass_fallback.js` asserts `sanitize("Impact") === "Arial Black"` via a duplicated map copy, not via importing `assGenerator.ts`. If `assGenerator.ts` changes mapping to `Impact→Inter` (licensing), this stale test would still PASS (its local map). `check_fallback.mjs` checks file string `a.includes("Arial Black")` — if `assGenerator` moves fallback to dynamic import, string check may still PASS vacuously while runtime mapping is broken. `verify-tester.js` preset at line 63 `preset==='Bold Drop'?60:52` pins old `fontSize` 60 without WYSIWYG scale (current `assGenerator` scales 60→184). A future PR correcting preset to 48 would break verifier but not be a bug — stale pin.
- **Impact:** Schema drift (DB v3 adding `videoDims` column) would not update seeder’s `proj` object (line 88 `videoBlob, thumbnailDataUrl, settings, captionStyle, segments, originalSegments` — no `videoDims`), causing silent fallback to 1280×720 (export.ts:106) but test still PASS.
- **Suggested Fix:** Delete duplicated maps; import `ASS_FONT_FALLBACKS` directly (`import { generateASS } from "@/lib/assGenerator"` via `tsx`). Make seeder include `videoDims: {w:1080,h:1920}` derived from `getVideoMetadata`.

---

## [BUG-TEST-11] Test infra bugs — shared mutable state between tests, non-deterministic ordering

- **File:** `temp-e2e/downloads/` (shared output dir), `verify-tester.js` lines 17-18 (`OUT` global), `canvas-burn-verify.mjs` lines 14-16, `final-local-verify.mjs` lines 16-18, `wysiwyg-verify.mjs` lines 14-18
- **Severity:** Medium
- **Category:** Tests
- **Description:** All verifiers write to the **same** `temp-e2e/downloads` directory with overwriting filenames (`verify-portrait-editor.png`, `canvas-5s.jpg`, `final-local-captioned.mp4`). No per-test isolated context. `verify-tester.js` seeds two projects `0928bab7...` (7-seg) and `75aaa111...` (75-seg) into the **same** `capai_db` IndexedDB without clearing between runs — second run sees leftover 7-seg project and may show 7 segments in 75-seg modal (race). `browser.newContext({viewport:1280x900})` is created once per script but never isolated per test; cookies/storage persist. `ffmpeg` singleton `exportFFmpeg` (export.ts:155) is module-global — verifier A’s `resetExportFFmpeg()` affects verifier B. Ordering is non-deterministic: `verify-tester.js` runs 7-seg then 75-seg export sequentially but reuses same `page` — 75-seg `fontsdir` population (500 KB fetch) may still be pending when 7-seg seek happens (line 145 `page.goto(/projects/ID7)` then immediate `waitForTimeout(1500)`) — race causes `aspectRatio` check to use stale `stageInfo`.
- **Impact:** Running `node verify-tester.js; node canvas-burn-verify.mjs` back-to-back yields flaky `canvas-diff-5s.jpg` diff 6KB vs 67KB depending on leftover state — CI green then red.
- **Suggested Fix:** Use Playwright `test.describe` with `test.use({ storageState: { cookies:[], origins:[] } })`, `test.beforeEach(async ({ page })=>{ await page.evaluate(()=> indexedDB.deleteDatabase('capai_db')) })`, unique `DOWNLOADS` per testId (`downloads/{testId}`). Isolate ffmpeg via `resetExportFFmpeg()` in `beforeEach`.

---

## [BUG-TEST-12] Coverage config missing — uncovered critical branches not flagged, `eslint` coverage gap

- **File:** `package.json` (no coverage), `.gitignore`, `eslint.config.mjs` lines 1-20 (no `no-only-tests`, no `no-exclusive-tests`)
- **Severity:** Low
- **Category:** Tests
- **Description:** No `coverage` thresholds, no `exclude: ["node_modules", "temp-e2e", ".next"]` — even if vitest installed, `src/lib/assGenerator.ts` line 155 `if (!videoWidth...) throw` branch would show 0% but not fail. `eslint` disables `react-hooks/preserve-manual-memoization` for `useVideoPlayer` (line 16) but does not enable `eslint-plugin-vitest` rules (`no-focused-tests`, `expect-expect`) that would catch `.only` left in committed tests. `tsconfig.json` includes `**/*.ts` (line 27) but `exclude: ["node_modules"]` only — test files would be type-checked, but no `test` tsconfig for DOM libs vs Node.
- **Impact:** A `it.only` committed accidentally would silently pass CI with 1 test green. Coverage on `hexToAssColour` opacityOverride branch (assGenerator:78) would never be enforced.
- **Suggested Fix:** Add `vitest.config.ts` with `coverage:{ provider:"v8", exclude:["**/*.config.*","temp-e2e/**",".next/**"], thresholds:{ statements:70 } }` and `eslint` override for `**/*.test.*` with `plugin:vitest/recommended`.

---

## [VERIFY] Uncertain finding — needs runtime confirmation

- **File:** `src/lib/canvasExport.ts` vs `canvasRenderer.ts` WYSIWYG — no test asserts pure export vs canvas match
- **Severity:** Medium
- **Category:** Tests
- **Description:** `canvasExport.ts` (MediaRecorder canvas burn path) and `canvasRenderer.ts` both compute `WYSIWYG_REF_W=352` scaling but `canvasExport` fixes canvas at `1080×1920` while `canvasRenderer` uses `contentW* dpr`. No test compares `ffmpeg -vf ass` vs canvas MediaRecorder output at 3 s (`wysiwyg-verify.mjs` does visually but does not assert pixel diff <5%). Uncertain if divergence exists at 75-seg Bold — needs `ffmpeg ffprobe` + image diff threshold test.
- **Impact:** Preview matches export on 352→1080 but canvasExport path may use different `maxContentWidth` (needs measurement).
- **Confirmation needed:** Run `wysiwyg-verify.mjs` and inspect `wysiwyg-diff-3s.jpg` vs `prove-5s-diff.jpg` diff size; automate with `pixelmatch`.

---

## Appendix: Static verification performed

- `npx tsc --noEmit` → GREEN (file `tsc_verify.log` 0 errors)
- `Get-ChildItem src -Recurse -Include *.test.*,*.spec.*` → 0 hits (node_modules excluded)
- `Get-ChildItem . -Recurse -Include playwright.config.*` → 0 hits
- `package.json` scripts → no `test`
- `coverage` → no provider
- Playwright verifiers → NOT RUN (require `next dev` + 64 MB MP4 + COOP/COEP headers). Verified statically via file read.

