# Stream C — Business-Logic Bug Hunt (CapAI)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`
**Date:** 2026-09-07
**Scope (assigned):** `src/lib/gemini.ts`, `src/lib/canvasExport.ts`, `src/lib/canvasRenderer.ts`, `src/lib/export.ts`, `src/lib/ffmpeg.ts`, `src/lib/assGenerator.ts`, `src/lib/parseTranscription.ts`, `src/lib/utils.ts`, `src/lib/waveform.ts`, `src/context/EditorContext.tsx`, `src/hooks/useCaptionOperations.ts`, `src/app/projects/[id]/processing/ProcessingClient.tsx`, `src/components/modals/ExportModal.tsx`, `src/components/editor/CaptionList.tsx` + `CaptionRow.tsx`
**Mode:** READ-ONLY — no fixes applied, no data mutated. `npx tsc --noEmit` clean (no output).

## Inventory

- **Server actions / API routes:** None found. All heavy logic is client-side (Dexie IndexedDB, `fetch` to `generativelanguage.googleapis.com`, FFmpeg.wasm in-browser, `<canvas>` burn via `MediaRecorder`). No `src/app/api/**` or `app/**/route.ts` present. This means every validation/calculation is exposed to untrusted client — any “server-only” check must be treated as missing.
- **Business-logic modules:** listed above. Data flow: `extractAudio (FFmpeg)` ? `transcribeWithFallback` ? `groupWordsIntoSegments` ? `EditorContext (split/merge/update)` ? `canvasRenderer` vs `assGenerator` ? `exportViaCanvas` (primary) / `exportVideo` (FFmpeg fallback).

---

## [BUG-LOGIC-1] FFmpeg `-vf` quoting swallows `fontsdir`
- **File:** `src/lib/export.ts`, line 476
- **Severity:** Critical
- **Category:** Logic
- **Description:** `const primaryVf = ``ass=''${assName}'':fontsdir=/fonts`` ` is built assuming shell quoting. `ffmpeg.exec(args)` takes a literal array — single quotes become part of the filename. Fixed comment at line 471 correctly says `ass=''file'':fontsdir=/fonts` (colon outside quotes) is needed, but line 476 still builds with inner colon: the reader may miss that `assName` is `subtitles.ass` (no spaces) so this happens to work for the default name, but any future rename with spaces or `:` (Windows temp names) would silently search for a literal file `''subtitles.ass:fontsdir=/fonts''` and exec returns 0 without burn. Fallback `subtitles=''…'' ` line 477 has the same risk.
- **Impact:** Valid MP4 with zero captions, preview shows captions ? perceived data loss.
- **Suggested Fix:** Keep `ass='subtitles.ass':fontsdir=/fonts` and normalize `assName` via `encodeURIComponent` / assert no spaces; add log-buffer detection already present (line 504-546) but promote.
- **Reproduction:** Rename `assName` to `my file.ass` ? burn shows `No such file` in log buffer but UI reports success before fix.

## [BUG-LOGIC-2] Identical-size output guard false-positive for tiny videos
- **File:** `src/lib/export.ts`, line 606
- **Severity:** High
- **Category:** Logic
- **Description:** `if (segments.length>0 && Math.abs(outData.length - videoBlob.size) < 5000) throw …` assumes re-encode always changes size by >5KB. For a 9 KB test clip or highly compressible solid-color video, `ultrafast+crf23` can coincidentally land within 5KB and throw “captions not burned” even though burn succeeded. Conversely an input already 8 MB that fails to burn but gets re-encoded could differ by >5KB and pass warn-only.
- **Impact:** False error for small fixtures / unit tests; false success for large “no-burn” case.
- **Suggested Fix:** Compare hash or probe with `ffprobe` for subtitle stream existence, not size delta.

## [BUG-LOGIC-3] `< 10 KB` guard too coarse for audio-only fallback
- **File:** `src/lib/export.ts`, line 601 + `src/lib/canvasExport.ts`, line 688
- **Severity:** High
- **Category:** Logic
- **Description:** `if (outData.length < 10000) throw …` at export and `blob.size < 10000` at canvasExport treats any sub-10KB file as failure. A 200 ms silent clip or 100×100 thumbnail video legitimately encodes to <10KB and would be rejected. The check is correct for 52s 1080×1920 but not as generic guard.
- **Impact:** Blocks valid short exports.
- **Suggested Fix:** Scale threshold by duration: `minBytes = durationMs * 200 /* ~200 B/ms */` or check `ffprobe` duration.

## [BUG-LOGIC-4] Concurrent exports race on shared filenames/MEMFS
- **File:** `src/lib/export.ts`, lines 369-374, 507-532; `src/lib/ffmpeg.ts`, lines 129-142
- **Severity:** Critical
- **Category:** Logic (Race Condition)
- **Description:** Both singletons use fixed names `input.mp4`, `subtitles.ass`, `output.mp4` and do `deleteFile` ? `writeFile` ? `exec` without a mutex. Two rapid `Start Export` clicks (ExportModal double-click) or parallel `extractAudio` + `exportVideo` can interleave deletes/writes, causing one exec to read the other’s partial input. `exportFFmpeg` and `ffmpegInstance` share no lock; `getExportFFmpeg` only dedupes loads, not execs.
- **Impact:** Corrupt output, “0 Dialogue” errors, or stale video re-used.
- **Suggested Fix:** Mutex / per-export UUID filenames (`input-${uuid}.mp4`) and `await lock` around the critical section; disable button while `step===2`.

## [BUG-LOGIC-5] `/fonts` empty ? libass “No usable font” = transparent captions
- **File:** `src/lib/export.ts`, lines 410-468
- **Severity:** Critical
- **Category:** Data/Logic
- **Description:** Code fetches `https://raw.githubusercontent.com/google/fonts/.../Inter-Regular.ttf` at runtime to populate `/fonts`. If fetch fails (offline, CORS, CSP, GitHub rate limit) the block only `console.warn`s and proceeds. libass then logs `No usable font` and renders transparent glyphs, but `ffmpeg.exec` still exits 0 ? `readFile output.mp4` succeeds ? UI shows ? Done with no visible text. This matches the “stickman at 0:05 but no text” report.
- **Impact:** Silent success with missing captions, especially offline on Windows.
- **Suggested Fix:** Hard-fail if `listDir("/fonts")` still empty after fetch attempts; bundle a minimal TTF in `public/fonts`.

## [BUG-LOGIC-6] WYSIWYG scale mismatch across renderers (width vs height)
- **File:** `src/lib/canvasRenderer.ts`, lines 181-192; `src/lib/assGenerator.ts`, lines 181-187
- **Severity:** High
- **Category:** Logic (Calculation)
- **Description:** Canvas preview scales font by `canvasWidth/352` (width-only) while vertical offset scales by `canvasHeight/720`. ASS header uses `PlayResX/Y` = coded dims but font scale uses `playResX/352` only. For 9:16 (1080×1920) vs 16:9 (1280×720), height-derived `MarginV` and `positionOffsetY` diverge from font scale ? captions centered in preview appear off-screen or clipped in export. This compounds BUG-LOGIC-8 (rotation).
- **Impact:** 1080×1920 Bold Drop captions rendered in preview at bottom 84% (˜1610 px) land off-screen after transcode if coded dims are 1920×1080.
- **Suggested Fix:** Unify scale to `min(w/352, h/720)` or anchor to `PlayRes` diagonal; snapshot test with 1080×1920.

## [BUG-LOGIC-7] Gap handling divergence: ASS highlights first word, canvas shows all-white
- **File:** `src/lib/assGenerator.ts`, lines 322-343 vs `src/lib/canvasRenderer.ts`, lines 119-126,438-445
- **Severity:** High
- **Category:** Logic
- **Description:** `generateASS` has a 150 ms gap fix: if `firstWordStart - segStart >150` it emits an extra dialogue where first word is gold (`activeAss`) to avoid white-on-white on bright stickman. `renderCaption` / `getActiveWordIndex` has no equivalent — if `currentTimeMs` falls in that gap, `getActiveWordIndex` returns -1 ? all words drawn with `inactiveWordColor` (`#FFFFFFAA` 33% white) ? invisible on bright background at 0:05. Canvas burn therefore loses captions exactly where ASS succeeds, explaining “canvas guarantees captions at 0:05” fragility.
- **Impact:** Canvas export (primary engine) shows no caption at the first 150 ms of each segment on bright video.
- **Suggested Fix:** Mirror ASS logic in `canvasRenderer` — if gap >150ms and `t < firstWordStart`, highlight word 0.

## [BUG-LOGIC-8] `parseTranscription.groupWordsIntoSegments` NaN `wordsPerSegment` ? zero segments, no error
- **File:** `src/lib/parseTranscription.ts`, lines 28-33
- **Severity:** Medium
- **Category:** Logic/Data
- **Description:** `const per = Math.max(1, Math.min(5, Math.floor(wordsPerSegment)))`. If caller passes `NaN` (e.g., corrupted Dexie `settings.wordsPerSegment` after migration, or `undefined` cast), `Math.floor(NaN)=NaN`, `Math.min(5, NaN)=NaN`, `Math.max(1, NaN)=NaN` ? `per = NaN`. Loop `for (i=0; i<words.length; i+=per)` then does `i+=NaN` ? `i=NaN` ? condition `NaN < len` false ? returns `[]`. Caller in `ProcessingClient.tsx` line 245 then throws “No caption segments produced” (generic), masking root cause.
- **Impact:** Corrupted project settings yields silent empty export with misleading error.
- **Suggested Fix:** `Number.isFinite(per) ? per : 3` fallback and validate before persist.

## [BUG-LOGIC-9] `splitSegment` leaves overlapping time intervals
- **File:** `src/context/EditorContext.tsx`, lines 474-559
- **Severity:** High
- **Category:** Logic
- **Description:** Split timing uses `seg1.endMs = w1[w1.length-1]?.endMs ?? t` and `seg2.startMs = w2[0]?.startMs ?? t` verbatim. If words overlap or have gaps, `seg1.endMs` can be > `seg2.startMs` (overlap) or far apart (gap). Code has `if (seg1.endMs > seg2.startMs) { // keep as is }` comment but does not clamp. Two segments then both active at same `currentTimeMs` ? `activeSegment` (first match) flickers, and `generateASS` emits overlapping Dialogue lines ? libass picks last one (intermittent missing word at split point).
- **Impact:** User-visible jitter at split point; export may double-draw or skip highlight.
- **Suggested Fix:** Clamp `seg1.endMs = Math.min(seg1.endMs, seg2.startMs)` or insert 1 ms gap; validate `startMs < endMs` after split.

## [BUG-LOGIC-10] `updateSegmentWords` does not sync segment `startMs/endMs`
- **File:** `src/hooks/useCaptionOperations.ts`, lines 100-110
- **Severity:** Medium
- **Category:** Data
- **Description:** `updateSegmentWords(id, words)` rebuilds `text` and `confidence` but never updates `startMs/endMs` from `words[0].startMs` / `words[last].endMs`. If words are edited to different timing (e.g., pasted with new timestamps), segment bounds stay stale. Downstream `generateASS` clamps per-segment `segStart/segEnd` but `findActiveSegment` (canvas) uses stale bounds ? caption disappears outside original bounds.
- **Impact:** Edited word timings silently ignored in preview/canvas burn.
- **Suggested Fix:** Also set `startMs = words[0]?.startMs ?? seg.startMs`, `endMs = words[last]?.endMs ?? seg.endMs`.

## [BUG-LOGIC-11] `updateSegmentText` heuristic timing overlaps for tail words
- **File:** `src/hooks/useCaptionOperations.ts`, lines 49-97
- **Severity:** Medium
- **Category:** Logic
- **Description:** When `rawWords.length > seg.words.length`, tail words reuse `existing` word for first N positions but interpolate new words with uniform slice `dur / rawWords.length`. Example: 2-word segment 0-2000, new text 3 words ? slice 666, word2 kept as 1000-2000 (original), word3 new as 1333-2000 ? overlap 1333-2000. No dedup or re-flow of earlier timings.
- **Impact:** Subsequent `generateASS` gap logic misfires; duration may invert if word count grows large.
- **Suggested Fix:** Re-distribute all words uniformly when count mismatches, or scale original timings proportionally.

## [BUG-LOGIC-12] `seekTo` clamp uses `Number.MAX_SAFE_INTEGER` when `durationMs` unknown
- **File:** `src/context/EditorContext.tsx`, lines 354-372
- **Severity:** Medium
- **Category:** Logic
- **Description:** `const clamped = Math.max(0, Math.min(ms, durationMs || Number.MAX_SAFE_INTEGER))`. If metadata not yet loaded (`durationMs=0`), seeking to 0:05 (5000 ms) assigns `video.currentTime = 5` correctly, but internal `currentTimeMs` state also set to 5000 — okay. However seeking to `durationMs+500` after load with stale ref could set `currentTime=900719.../1000` ? `video.currentTime = Infinity` ? throws `Failed to set currentTime`. More critically, `addSegment` at line 597 uses `dur ? Math.max(0, dur-100) : t` — if `dur=0` it treats as no duration and creates `start=t, end=t+2000` even if video is 60s, so segment at 50s near end extends beyond file without clamp.
- **Impact:** Edge seek error before metadata; blank segment beyond duration ? empty export tail.
- **Suggested Fix:** Guard `if (!durationMs) return` or use `video.duration` fallback; clamp `addSegment` end to `video?.duration`.

## [BUG-LOGIC-13] Gemini `classifyGeminiError` 400 treated as `transient` with `noRetry=true` — ambiguous with `transient` retry path
- **File:** `src/lib/gemini.ts`, lines 158-160,250-252,517-520
- **Severity:** High
- **Category:** Logic/Error Handling
- **Description:** HTTP 400 is mapped to `{code:"transient", noRetry:true}`. In `transcribeWithFallback` line 518 `if (classification.noRetry || httpStatus===400) throw GeminiKeyError(..., true)` — this aborts rotation even for transient 400 caused by one bad key’s payload (e.g., oversized `audioBase64`). A second key with same payload would also 400, but first key failure now prevents trying others, yet the payload itself is bad ? retrying would also fail. The opposite direction: a per-key 400 due to key-specific quota message containing “400” substring (line 185 regex) also triggers `noRetry`, incorrectly blocking fallback for rate-limited keys that mentioned 400 in body.
- **Impact:** Either wastes keys on payload errors or incorrectly stops fallback on rate limits masquerading as 400.
- **Suggested Fix:** Distinguish `invalid_request` (no retry across keys) vs `transient` (retry); parse body `code` instead of hunting substring.

## [BUG-LOGIC-14] `parseRetryAfterHeader` HTTP-date diff capped to <24h ignores future Retry-After
- **File:** `src/lib/gemini.ts`, lines 119-125
- **Severity:** Medium
- **Category:** Logic
- **Description:** If server returns `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` 25 hours in future, `diff > 24*3600*1000` ? `return null` ? caller substitutes `60_000` (1 min) and retries immediately, violating server backoff. Also fractional `Retry-After: 0.5` header (0.5s) via `parseInt(trimmed)` at line 106 truncates to 0 ? 0 ms backoff.
- **Impact:** Rate-limit hammering, second 429, wasted keys.
- **Suggested Fix:** Return `diff` even if >24h (clamp to 24h max) and use `parseFloat` for header.

## [BUG-LOGIC-15] `transcribeWithFallback` delay `setTimeout 180ms` leaks abort listener
- **File:** `src/lib/gemini.ts`, lines 530-541
- **Severity:** Medium
- **Category:** Logic (Resource Leak)
- **Description:** Each retry does `signal.addEventListener("abort", onAbort, {once:true})` inside a new Promise but never removes the listener if the delay resolves normally. After 5 keys, 4 listeners accumulate on the same `AbortSignal`. Not critical in this local flow but violates “remove after resolve” hygiene and could fire stale rejects if signal aborted later.
- **Impact:** Minor leak; aborted signal after success could still reject a settled promise branch (unhandled rejection).
- **Suggested Fix:** `signal.removeEventListener` after `resolve`, or use `AbortSignal.timeout`.

## [BUG-LOGIC-16] `canvasExport.findActiveSegment` double-pass is dead code
- **File:** `src/lib/canvasExport.ts`, lines 86-102
- **Severity:** Low
- **Category:** Logic (Dead Code)
- **Description:** First loop over segments already checks `t >= s.startMs-60 && t <= s.endMs+60` and returns if core contains `t`; otherwise it falls through. Second loop is identical range check ? always returns same `s` as first loop would have in grace case. The “prefer core then grace” comment is misleading; first loop’s inner `if (t>=s.startMs && t<=s.endMs) return s` makes first loop equivalent to grace-only when no core matches? Actually both loops identical, so two passes are redundant. No functional bug but confuses future fix for BUG-LOGIC-7.
- **Impact:** Maintainer confusion, hides gap bug.
- **Suggested Fix:** Single loop: `if core return else track first grace and return after loop`.

## [BUG-LOGIC-17] `ProcessingClient` transcribe progress interval continues after error
- **File:** `src/app/projects/[id]/processing/ProcessingClient.tsx`, lines 172-224
- **Severity:** Medium
- **Category:** Logic
- **Description:** `progInterval` is cleared in success path and in the `catch` inside the `try { transcribeWithFallback }` block (line 208), but if `transcribeWithFallback` throws synchronously before `progInterval` assignment? Actually assignment precedes try, so okay. However if `cancelledRef` early-return at line 191 clears interval? No interval cleared, but function returns without clearing because clear is inside catch only. Path `if (cancelledRef||abortSignal.aborted){ clearInterval; return }` does clear, but `if` after `result = await` not reached. So most leaks covered, but `extractAudio` failure path (line 157 throw) bypasses `progInterval` clear entirely because interval not yet created — safe. The real leak is `runPipeline`’s outer `catch` at line 274 does not clear interval if error thrown after it was started but before inner catch clears it (e.g., `groupWordsIntoSegments` throws after transcribe succeeded). Then interval keeps ticking while error UI shows.
- **Impact:** UI shows `progress 68%` spinners forever after error.
- **Suggested Fix:** Wrap interval in `finally` or `useRef` and clear in unmount + outer catch.

## [BUG-LOGIC-18] `uint8ToBase64` spread may overflow call stack for large audio
- **File:** `src/lib/ffmpeg.ts`, lines 94-102
- **Severity:** High
- **Category:** Performance/Logic
- **Description:** `String.fromCharCode(...chunk)` spreads up to 0x8000 (32768) arguments. V8’s max arguments ~120k, but 32k is near limit and for a 50 MB MP3 (~66 MB base64) this is called ~1500 times; each spread allocates an arguments array. On some engines / older Chrome it throws `RangeError: Maximum call stack size exceeded`. Also `btoa(binary)` on huge string may throw `InvalidCharacterError` for non-Latin1.
- **Impact:** Large video (e.g., 60 MB) transcription fails with stack overflow masquerading as “network error”.
- **Suggested Fix:** Use chunked `String.fromCharCode.apply(null, chunk)` loop or `TextDecoder` streaming.

## [BUG-LOGIC-19] `isValidThumbnailDataUrl` duplicated with different thresholds
- **File:** `src/lib/db.ts`, lines 63-67 vs `src/lib/thumbnail.ts`, lines 190-195
- **Severity:** Low
- **Category:** Logic/Data (Inconsistency)
- **Description:** `db.isValidThumbnailDataUrl` and `thumbnail.isValidThumbnailDataUrl` are duplicates but thresholds differ slightly comments (one says <500k, other same). If one is updated, the other diverges. `generateThumbnail` also validates with same check (line 137-141) but uses `placeholderThumbnail()` SVG on invalid — that SVG is ~300 chars, but `isValid...` treats any `data:image/svg+xml` as valid without size check, so downstream `ProjectCard` may render huge SVG if injected.
- **Impact:** Maintenance drift, potential XSS via crafted SVG if stored in Dexie (no sanitization) — though dataUrl is rendered as `<img src>` so safer, but still renders attacker-controlled SVG.
- **Suggested Fix:** Single export from `thumbnail.ts`, import in `db.ts`; sanitize SVG length.

## [BUG-LOGIC-20] `formatTime` vs `parseTime` asymmetry for `H:MM:SS.mmm`
- **File:** `src/lib/utils.ts`, lines 20-54
- **Severity:** Medium
- **Category:** Logic
- **Description:** `formatTime` outputs `MM:SS.mmm` (minutes may exceed 59, e.g., `90:00.000`). `parseTime` expects same format (`/^(\d+):(\d{2})\.(\d{1,3})$/`). A duration >60 min (e.g., 3720000 ms = `62:00.000`) parses correctly, but UI `formatDuration` for header uses `H:MM:SS`. User cannot type `1:02:00.000` into the timestamp editor (chars not matching regex) even though video can be >60 min. Also `parseTime` rejects `00:05.5` (single digit millis padded to 500) — actually it accepts via `padEnd`, but `05.50` (two digits) padded to 500 not 50 — subtle off-by-10x if user types two digits.
- **Impact:** Editor timestamp edit fails for long videos; two-digit millis misparsed.
- **Suggested Fix:** Accept `H?:MM:SS.mmm` and normalize millis: `Number(match[3].padEnd(3,"0"))`.

---
*Read-only findings — verify each with runtime logs / decoded output before fixing. `npx tsc --noEmit` clean.*
