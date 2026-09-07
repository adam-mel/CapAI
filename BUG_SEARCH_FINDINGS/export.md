# Stream C — Business-Logic Bug Hunt: Export Pipeline (Captions Missing at 0:05)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`  
**Scope:** `src/lib/export.ts`, `src/lib/assGenerator.ts`, `src/lib/ffmpeg.ts`, `src/lib/ffmpegConfig.ts`, `src/components/modals/ExportModal.tsx`, `next.config.ts`, `src/lib/presets.ts`  
**Scenario traced:** 75 segments, 1080x1920 52s, Bold Drop (Impact 60, gold), Dynamic Pop -> `generateASS` -> `writeFile subtitles.ass` -> `ffmpeg -vf ass` -> `readFile` -> blob URL -> download. User sees stickman at 0:05 but no text.

> READ-ONLY — no fixes applied. All findings are hypotheses to verify with runtime logs / decoded output.

---
## [BUG-LOGIC-1] FFmpeg -vf quoting puts fontsdir inside filename
- **File:** `src/lib/export.ts`, lines 383-384
- **Severity:** Critical
- **Category:** Logic
- **Description:** `const primaryVf = "ass='subtitles.ass:fontsdir=/fonts'"` uses single quotes inside filter graph. With `ffmpeg.exec([...])` there is no shell; the array element is literal. `ass='subtitles.ass:fontsdir=/fonts'` is parsed as filter `ass` with arg `'subtitles.ass:fontsdir=/fonts'` (quotes included). `:` inside quotes is not separator, so `fontsdir` never parses — libass tries to open file literally named `'subtitles.ass:fontsdir=/fonts'`. Correct is `ass=subtitles.ass:fontsdir=/fonts` or `ass='subtitles.ass':fontsdir=/fonts`.
- **Impact:** libass non-fatal error (logs `Unable to open` but exec returns 0) -> encode succeeds without overlay -> user downloads MP4 with no captions at 0:05. Fallback `subtitles='...'` has same bug.
- **Suggested Fix:** `const vf = "ass=subtitles.ass:fontsdir=/fonts"` (no inner quotes). Verify via `ffmpeg.on(log)` for `No such file`.
- **Reproduction:** 1080x1920 Bold Drop export -> console.debug shows `vf ass='subtitles.ass:fontsdir=/fonts'` -> `ffmpeg.readFile('subtitles.ass')` succeeds but exec logs `No such file: 'subtitles.ass:fontsdir`.

## [BUG-LOGIC-2] Missing -y overwrite flag
- **File:** `src/lib/export.ts`, lines 391, 394
- **Severity:** High
- **Category:** Logic
- **Description:** Args lack `-y`. Code does `await ffmpeg.deleteFile(outputName)` before exec, but if delete fails (FS locked after abort), FFmpeg without `-y` prompts `File exists` and hangs (wasm no stdin). Large 52s file may appear stuck at 0-4%.
- **Impact:** Flaky hangs, stale output.mp4 reused on retry -> missing captions.
- **Suggested Fix:** Prepend `-y` to args.

## [BUG-LOGIC-3] Swallowed 0 Dialogue guard
- **File:** `src/lib/export.ts`, lines 275-299
- **Severity:** Critical
- **Category:** Logic
- **Description:** `if (dlgCount===0) throw new Error("0 Dialogue")` is inside `try` whose `catch` only `console.warn`s. Error never propagates; execution continues to write header-only ASS and exec.
- **Impact:** Empty ASS (header only, >80 bytes) still burns -> valid MP4 with zero captions, no error shown.
- **Suggested Fix:** Move check outside diagnostic try or re-throw.

## [BUG-LOGIC-4] Fallback classification uses stale lastErr
- **File:** `src/lib/export.ts`, lines 386-439
- **Severity:** Medium
- **Category:** Logic
- **Description:** `lastErr` set only when exec throws, not when it returns non-zero code (common for `No such filter: ass`). So `isFilterMissing` false -> generic `Video encoding failed (exit 1)` rather than actionable hint.
- **Impact:** Misleading error hides root cause of BUG-LOGIC-1.
- **Suggested Fix:** Capture stderr via log buffer, treat any non-zero as filter failure.

## [BUG-LOGIC-5] /fonts assumed present in MEMFS
- **File:** `src/lib/export.ts`, lines 161-166,380-384; `src/lib/assGenerator.ts`, lines171-180
- **Severity:** Critical
- **Category:** Logic/Data
- **Description:** Code writes only `subtitles.ass` and input video, never writes `.ttf` files. Assumes `@ffmpeg/core@0.12.10` bundles fonts at `/fonts`. Many builds have empty `/fonts`. libass then logs `No usable font` and renders transparent glyphs, but exec returns 0.
- **Impact:** Even with correct vf, no captions visible. Canvas preview (browser Google Fonts) works, export does not.
- **Suggested Fix:** After load, `await ffmpeg.writeFile("/fonts/DejaVuSans.ttf", await fetchFile(fontUrl))` or remove fontsdir. Verify via `ffmpeg.listDir("/fonts")`.

## [BUG-LOGIC-6] Font fallback map case-sensitive
- **File:** `src/lib/assGenerator.ts`, lines165-180
- **Severity:** High
- **Category:** Logic
- **Description:** `ASS_FONT_FALLBACKS` key `Impact` exact only. If `style.fontFamily` is `"impact"` or with quotes/spaces, fallback misses and ASS keeps `Impact` which has no file -> invisible. Preset is exact `Impact`, but Custom edits may differ.
- **Impact:** Custom Impact invisible.
- **Suggested Fix:** Normalize `key = rawSanitized.toLowerCase()`.

## [BUG-LOGIC-7] Segment filtering can drop all dialogues
- **File:** `src/lib/assGenerator.ts`, lines275-310
- **Severity:** High
- **Category:** Logic
- **Description:** `hasText/hasWords` skip may drop segments with `word=""` or `NaN` times from `groupWordsIntoSegments`. Corrupted `startMs` NaN leads to `segEnd <= segStart` -> `continue`.
- **Impact:** Video stickman at 0:05 but no caption because that segment filtered.
- **Suggested Fix:** Validate `Number.isFinite(seg.startMs)` before push.

## [BUG-LOGIC-8] PlayRes rotation mismatch for 1080x1920
- **File:** `src/lib/export.ts`, lines62-147,242-263; `src/lib/assGenerator.ts`, lines154-160
- **Severity:** Critical
- **Category:** Logic/Data
- **Description:** `getVideoMetadata` uses `video.videoWidth/Height` (display, already rotated). FFmpeg without `-noautorotate` decodes coded dims (e.g., 1920x1080). PlayRes 1080x1920 gives baseline Y~1645 which on 1080-high decoded frame is off-screen below.
- **Impact:** Vertical phone video (most common) captions completely off-screen, while 16:9 works. Exactly matches 1080x1920 report.
- **Suggested Fix:** Probe rotation via ffprobe or add `-noautorotate` + explicit transpose, set PlayRes to coded dims.

## [BUG-LOGIC-9] Output verification only warns
- **File:** `src/lib/export.ts`, lines459-477
- **Severity:** High
- **Category:** Logic
- **Description:** `if (outData.length===videoBlob.size) console.warn` and `<10k` only warn, no throw. Identical size indicates vf bypassed (no re-encode). Still returns blob.
- **Impact:** Caption-less file passes as success.
- **Suggested Fix:** Throw if identical or <10k.

## [BUG-LOGIC-10] Color alpha semi-transparent on bright background
- **File:** `src/lib/assGenerator.ts`, lines50-94,182-197
- **Severity:** Medium
- **Category:** Logic
- **Description:** For `inactiveWordColor="#FFFFFFAA"` (Reels/Clean) alpha 85 (~33% transparent) -> white at 66% opacity plus outline 2 may be nearly invisible on bright stickman at 0:05. Bold Drop opaque fine but preset switch not.
- **Impact:** Perceived missing captions on default presets.
- **Suggested Fix:** Document opacity, clamp to opaque for export.

## [BUG-LOGIC-11] Progress time unit mismatch
- **File:** `src/lib/export.ts`, lines306-323
- **Severity:** Medium
- **Category:** Logic
- **Description:** `progress.time` may be microseconds (5_000_000 at 5s) but code treats as seconds: `time/(durationMs/1000)` -> huge pct capped to 95 instantly.
- **Impact:** UX stuck at 95% then hang -> user aborts.
- **Suggested Fix:** Normalize: `tSec = time>10000 ? time/1e6 : time`.

## [BUG-LOGIC-12] Abort terminate races
- **File:** `src/lib/export.ts`, lines325-335,499-511
- **Severity:** High
- **Category:** Logic
- **Description:** `onAbort` does `ffmpeg.terminate(); resetExportFFmpeg();` destroying MEMFS mid-exec. Next export reuses same `input.mp4` name while old FS terminating -> stale file reused.
- **Impact:** After cancel, next export may use wrong video -> missing captions.
- **Suggested Fix:** Mutex + unique filenames per export.

## [BUG-LOGIC-13] getInputFileName ext heuristic
- **File:** `src/lib/export.ts`, lines43-56
- **Severity:** Low
- **Category:** Data
- **Description:** For `Blob.type=""` and no dot in projectName, defaults to `mp4` even if blob is webm/VP9. ` -c:a copy` to mp4 may fail for opus.
- **Impact:** WebM fails with generic error.
- **Suggested Fix:** Sniff magic or re-encode audio.

## [BUG-LOGIC-14] console.debug hidden, vf log never runs on early return
- **File:** `src/lib/export.ts`, lines390,366; `src/components/modals/ExportModal.tsx`, lines273-287
- **Severity:** Medium
- **Category:** Logic
- **Description:** Critical `vf` log is `console.debug` (hidden when Info filtered). If early return due to `!width||!height`, vf log never runs, but output.mp4 from previous run cached in resultUrl may still be downloadable.
- **Impact:** Debugging misled.
- **Suggested Fix:** Promote to `console.info`/`warn`.

## [BUG-LOGIC-15] ExportModal stale resultUrl after failed guard
- **File:** `src/components/modals/ExportModal.tsx`, lines230-327,140-149
- **Severity:** High
- **Category:** Logic
- **Description:** `handleStartExport` clears resultUrl via closure stale `resultUrl` dep. Rapid double-click or dims guard early return may leave `handleDownload` pointing to revoked or previous blob (different style/dims) -> downloads old file without new captions.
- **Impact:** User downloads old caption-less file after failed retry.
- **Suggested Fix:** Disable download when `step!==3`, store hash.

## [BUG-LOGIC-16] COOP/COEP headers block unpkg fetch via require-corp
- **File:** `next.config.ts`, lines5-19; `src/lib/export.ts`, lines192-203
- **Severity:** High
- **Category:** Security/Logic
- **Description:** `require-corp` blocks `fetch(unpkg)` without CORP header. Error is `ERR_BLOCKED_BY_RESPONSE` not matching regex `/SharedArrayBuffer|COOP|COEP/` -> generic network error, not actionable COOP hint. Dev on Windows Chrome sees stuck export.
- **Impact:** FFmpeg fails to load, not silent but masks root cause.
- **Suggested Fix:** Host core locally under same origin.

## [BUG-LOGIC-17] Download revoke races with browser stream
- **File:** `src/components/modals/ExportModal.tsx`, lines140-149,329-344
- **Severity:** Medium
- **Category:** Logic
- **Description:** `useEffect` cleanup revokes `resultUrl` on unmount (closing modal) within same tick as `a.click()`. On Firefox/slow Chrome large 52s file, revoke cancels download mid-stream -> 0-byte or truncated file (stickman no text because file incomplete).
- **Impact:** Intermittent truncated downloads.
- **Suggested Fix:** Delay revoke 60s or until visibilitychange.

---
## Cross-cutting hypothesis for 0:05

Most likely chain is BUG-LOGIC-5 (no fonts) + BUG-LOGIC-1 (vf quoting) + BUG-LOGIC-8 (rotation off-screen). Any one yields valid MP4 with no visible text while canvas preview works.

Verify: `await ffmpeg.listDir("/fonts")`, inspect `ffmpeg.on(log)` for `No usable font|Unable to open`, `ffprobe output.mp4` size vs input.

---
*Generated read-only — no files modified.*
