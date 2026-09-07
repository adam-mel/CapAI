# Stream D — UI & Frontend Bug Hunt: 9:16 Preview Black Bars + Export No-Captions (0:05)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`  
**Scope:** `src/components/editor/VideoPlayer.tsx`, `src/components/editor/CanvasOverlay.tsx`, `src/components/editor/EditorShell.tsx`, `src/lib/canvasRenderer.ts`, `src/lib/assGenerator.ts`, `src/context/EditorContext.tsx`, `src/lib/export.ts`, `src/components/modals/ExportModal.tsx`  
**Scenario traced:** 9:16 vertical 1080x1920 52s, 75 segments, Bold Drop (Impact 60 gold, Pop) — preview shows huge black side bars + yellow `LITTLE MORE` at bottom, Media Player at 0:05 shows tall pillar but zero text. Audited preview?canvas?export coordinate chain.

> READ-ONLY — no fixes applied. All findings are hypotheses to verify with runtime logs, `getBoundingClientRect` dumps, and decoded `subtitles.ass` PlayRes inspection.

---

## [BUG-UI-1] Preview stage falls back to fixed `aspect-video` (16:9) before dims resolve — huge black side bars

- **File:** `src/components/editor/VideoPlayer.tsx`, lines 56-63, 397-399, 407-410
- **Severity:** High
- **Category:** UI / Logic
- **Description:** `stageStyle` is `undefined` when `dims===null` (initial mount, before `loadedmetadata` or `getVideoMetadata` blob probe resolves). The stage div then renders `class="... aspect-video"` (line 408) — a hard-coded 16:9. For a 1080x1920 (AR 0.5625) vertical, `object-contain` letterboxes the pillar centered inside the 16:9 box: pillarWidth approx 30% of stage width, leaving ~35% black bars left/right each. The comment at line 14-16 claims "Fixed: dynamic aspect-ratio" but fallback is still static 16:9. The outer card caps width via `outerStyle` only when `dims` present (line 397-398); when `dims` null it is `w-full` 16:9. Both EditorShell and VideoPlayer fetch dims async (`getVideoMetadata` + `loadedmetadata` listener + 20x150 ms poll), so the 16:9 placeholder persists 200 ms-3 s. If blob probe fails (see BUG-UI-9 swallowed catch), it persists forever — exactly the user screenshot (tall video inside short wide black container, `LITTLE MORE` small at bottom).
- **Impact:** User perceives 9:16 video "shown as 16:9" — broken layout on key view. Captions drawn relative to 16:9 canvas will be mis-placed vs 9:16 export PlayRes (see BUG-UI-2). Rapid project switch keeps stale flash.
- **Suggested Fix:** Never render `aspect-video`. Render skeleton with AR derived synchronously from `project.videoBlob` metadata cached in IndexedDB at upload time, or hide stage (`visibility:hidden`) until dims known, or default pillar to 9/16 when portrait unknown. Promote dims fetch to upload pipeline and store width/height in Project.
- **Reproduction:** Hard-refresh project with 1080x1920 60 MB MP4 on Slow 3G -> stage is 16:9 for ~1-2 s before snapping tall. Block `getVideoMetadata` (offline) -> stays 16:9. Measure `containerRef.getBoundingClientRect()` before/after dims.

---

## [BUG-UI-2] CanvasOverlay sizes to video *element* box, not displayed content rect — caption coordinates diverge from export ASS PlayRes

- **File:** `src/components/editor/CanvasOverlay.tsx`, lines 34-44, 92-93, 179-191
- **Severity:** High
- **Category:** Logic / UI
- **Description:** `syncSize` does `rect = video.getBoundingClientRect(); canvas.width = rect.width * dpr`. `getBoundingClientRect()` returns the *element layout box* (e.g., 640x360 for 16:9 fallback stage), not the *intrinsic content rect* after `object-contain` letterboxing. For 9:16 in 16:9 stage the visual pillar is approx 202 px wide centered inside 640 px, but canvas is 640 px wide. `renderCaption` then computes `maxContentWidth = canvasWidth * 0.88` and `baseY = canvasHeight*0.84` over the full 16:9 box. Export `generateASS` uses `PlayResX/Y = coded dims 1080x1920` (via `getVideoMetadata`) and `MarginV = videoHeight*0.16`. Preview X scales to 640, export X scales to 1080 — same logical point maps to different physical pixels. When stage later snaps to 9:16, ResizeObserver on `video` should fire and resync, but during the 16:9 window captions are drawn too wide (centered over black bars). Overlay container `absolute inset-0 h-full w-full` (line 186) always fills stage, never shrinks to pillar, so gap remains if `object-contain` letterboxes even by 1 px rounding.
- **Impact:** "Preview looks correct (yellow at bottom) but export off-screen" divergence. For vertical, export baseY approx 1610 px (bottom center) while preview baseY computed from 360 px high box -> 302 px, then scaled differently.
- **Suggested Fix:** Compute content rect: if `video.videoWidth/Height` known, scale `min(rect.width / videoWidth, rect.height / videoHeight)` then `contentW = videoWidth*scale`, `contentH = videoHeight*scale`, offset centering, size canvas to content rect and position it at offset. Alternatively change video to `object-cover`/`object-fill` after AR fix so rect===content, or make stage match AR exactly and use `object-fill`.
- **Reproduction:** With dims null (16:9 fallback), `console.log(video.getBoundingClientRect(), video.videoWidth, video.videoHeight, canvas.width)` -> rect 640x360 but pillar 202x360. After dims resolve, log again -> rect 360x640 pillar, canvas 360x640. Observe caption X shift.

---

## [BUG-UI-3] DPR scaling missing — preview captions half-size on Retina, export full-size

- **File:** `src/components/editor/CanvasOverlay.tsx`, lines 32-33, 98-101; `src/lib/canvasRenderer.ts`, lines 175-184, 292-344
- **Severity:** Medium
- **Category:** UI / Logic
- **Description:** `syncSize` sets `canvas.width = rect.width * dpr` (line 36-37) but `renderCaption` never calls `ctx.scale(dpr,dpr)` nor divides sizes by dpr. It does `c.setTransform(1,0,0,1,0,0)` (line 98) and draws with `fontSize = 60` directly in device pixels. On DPR=2, rect 360x640 -> backing 720x1280, but 60 px device = 30 px CSS — preview text appears half-size vs CSS expectation. Export ASS uses `fontSize 60` at PlayRes pixels (1:1 to CSS). Result: preview small captions centered, export large captions (or wrapping at different point). Comment at lines 95-101 explicitly says "No additional scaling needed" — incorrect.
- **Impact:** Inconsistent preview vs download. User sees tidy small yellow text in preview, but exported burn-in text is ~2x larger, may overflow width, wrap to 2 lines or be clipped, perceived as "different position." On 1x displays bug hides; on Retina Mac/phones it reproduces.
- **Suggested Fix:** Either keep backing at `rect.width*dpr` but `ctx.scale(dpr,dpr)` and draw in CSS pixels (divide canvasWidth/Height by dpr for layout), or set `canvas.width = rect.width` and rely on browser scaling. Scale `effectiveBaseSize` accordingly.
- **Reproduction:** Open preview on DPR=2 (MacBook Retina) vs DPR=1 (external 1080p) -> measure `canvas.width` vs `rect.width` and screenshot caption height. Export same file and compare glyph size in Media Player.

---

## [BUG-UI-4] CanvasOverlay render effect re-subscribes every frame — stale-response / jank

- **File:** `src/components/editor/CanvasOverlay.tsx`, lines 74-170 (dependency array line 170)
- **Severity:** High
- **Category:** Performance / Logic
- **Description:** `useEffect` for draw loop lists `[segments, captionStyle, settings.mode, currentTimeMs, videoRef]` (line 170). `currentTimeMs` ticks every `timeupdate` + rAF (approx 16-250 ms) via `EditorContext` (lines 262-311 rAF tick). Every tick the effect tears down (`removeEventListener play/pause/seeked/timeupdate`, `cancelAnimationFrame`) and re-creates a new `draw` closure and rAF loop. Likewise any StylePanel slider drag triggers same churn. This is an N+1 re-subscription storm: 30-60 effect re-runs per second while playing, causing dropped frames and potential lost events during teardown. `videoRef` object identity never changes, so `[videoRef]` alone would not re-run, but `currentTimeMs` dominates. Immediate `draw()` at line 121 uses closure `currentTimeMs` which is stale by the time `video.currentTime` is read inside `draw` (line 90) — mixing two time sources.
- **Impact:** Preview jank especially for 75 segments + karaoke highlight at 30 fps; on low-end Android canvas may visibly stutter, and final frame when paused (`stop()` final draw) may use stale `lastSegmentId` -> missed 200 ms fade.
- **Suggested Fix:** Split effects: one LayoutEffect for ResizeObserver (deps `[videoRef]`), one Effect for event wiring (deps `[videoRef]` stable), and a `useAnimationFrame` loop that reads `videoRef.current.currentTime` directly without `currentTimeMs` dep, or store `currentTimeMsRef`. Use refs for segments/style to avoid re-wiring. Remove `currentTimeMs` from deps.
- **Reproduction:** Play 52 s vertical with Dynamic Pop, profile Performance -> observe ~60 `useEffect` cleanups/sec. Add `console.count("overlay effect")` -> floods.

---

## [BUG-UI-5] `object-contain` leaves sub-pixel letterbox after dynamic AR fix — thin black bars persist

- **File:** `src/components/editor/VideoPlayer.tsx`, line 417
- **Severity:** Low
- **Category:** UI
- **Description:** After dims resolve, stage has `aspectRatio: 1080/1920` exactly matching video, so `object-contain` should fill perfectly. But due to container `rounded-[12px] border overflow-hidden` and `maxHeight 70vh` subpixel rounding, stage height may be 699.5 px floor/ceil vs `width/AR` 700.0 px, leaving 0.5 px gap where `bg-black` shows as hairline side bars. `object-contain` scales to fit *inside* box preserving AR, so any rounding error produces 1-2 px black line. `object-cover` would fill but crop; `object-fill` would stretch but match.
- **Impact:** Minor visual nit — preview shows faint side bars even when "fixed," eroding trust that 9:16 is truly pillar.
- **Suggested Fix:** Use `object-cover` or `object-fill` when `dims` present, or `object-contain` only during `aspect-video` fallback.
- **Reproduction:** Inspect stage with dims resolved on 1080p display fractional zoom 110% -> 1 px `bg-black` line visible left/right.

---

## [BUG-UI-6] Fullscreen canvas still fills 16:9 viewport black-bar area — captions shift in fullscreen

- **File:** `src/components/editor/VideoPlayer.tsx`, lines 57, 408-410; `src/components/editor/CanvasOverlay.tsx`, lines 179-191
- **Severity:** Medium
- **Category:** UI / Logic
- **Description:** In fullscreen `stageStyle===undefined` and stage class becomes `flex flex-1 items-center justify-center` (line 408). Stage expands to viewport (e.g., 1920x1080). Video `h-full w-full object-contain` centers pillar 608x1080 inside 1920 wide stage with ~656 px black bars each side. Canvas overlay is `absolute inset-0 h-full w-full` inside stage, so it covers 1920x1080, not pillar 608x1080. `renderCaption` computes `canvasWidth 1920` -> captions centered at 960, which is center of pillar but `maxContentWidth 0.88*1920=1689` vs pillar 608 -> line wraps far wider than pillar, text may spill onto black bars. Export PlayRes 1080x1920 centers at 540 — narrower. Fullscreen preview vs export not comparable, but if user enters fullscreen to verify placement, preview lies.
- **Impact:** Captions appear correctly centered in fullscreen but spill onto side black bars, wrapping differently than export.
- **Suggested Fix:** In fullscreen, same content-rect calculation as BUG-UI-2: size canvas to content rect and center it; or make fullscreen stage also `aspectRatio` constrained and letterbox viewport outside stage.
- **Reproduction:** Play, click Fullscreen on 9:16 video -> canvas width 1920 vs pillar 608; log `canvas.width, video.getBoundingClientRect()` in fullscreen -> mismatch.

---

## [BUG-UI-7] Font mismatch: preview Impact (system) vs export Arial Black fallback — wrapping diverges

- **File:** `src/lib/canvasRenderer.ts`, lines 19-22, 172-173; `src/lib/assGenerator.ts`, lines 165-180
- **Severity:** Medium
- **Category:** UI / Data
- **Description:** Preview `loadGoogleFont` skips `Impact` (system font) and renders canvas with `fontFamily: "Impact", Inter, sans-serif` (line 173) — metrics of Impact (ultra-condensed heavy). Export `generateASS` maps `Impact -> Arial Black` (line 172) because `Impact` not bundled in `@ffmpeg/core@0.12.10 /fonts`. `Arial Black` is wider, has different glyph advances. `canvasRenderer` measures wrapping via `ctx.measureText` with Impact metrics and `maxContentWidth 0.88*canvasWidth`; ASS libass wraps via `WrapStyle:0`, margins 10, and Arial Black metrics. A line that fits single-line at 1080 wide with Impact may wrap to two lines with Arial Black, shifting baseY block upward. Preview shows single-line yellow at bottom; exported may be two-line centered higher or clipped if MarginV off.
- **Impact:** Preview vs export visual parity broken — user sees yellow `LITTLE MORE` clean single line in preview screenshot but exported MP4 either shows two-line or no text at bottom if second line pushed off-screen.
- **Suggested Fix:** Either bundle Impact TTF and write to `/fonts/Impact.ttf` before encode (requires licensing) and keep Impact in ASS, or render preview with same fallback Arial Black to match export, or compute ASS wrapping to mimic canvas (insert \N breaks).
- **Reproduction:** Create segment with 8 long words, set Bold Drop Impact 60, preview screenshot vs exported frame at 0:05 -> wrap differs. Inspect subtitles.ass header `Style: Default,Arial Black` while canvas `ctx.font` contains Impact.

---

## [BUG-UI-8] Preview background pill vs export box mismatch — ghost rect in preview absent in export

- **File:** `src/lib/canvasRenderer.ts`, lines 353-398; `src/lib/assGenerator.ts`, lines 187-197, 232-260
- **Severity:** Medium
- **Category:** UI
- **Description:** When `pillEnabled===false` (Bold Drop/Reels presets: false), canvas still draws a subtle `rgba(255,255,255,0.08)` rounded rect per line (lines 379-397) — "200 ms fade spec — we just draw static 0.08." Export ASS sets `BorderStyle 1` (no box) and `BackColour` transparent (line 194-196). Preview shows faint translucent pill behind yellow text; export shows pure text with outline/shadow only. User may perceive preview as having background block that disappears in Media Player, or think captions missing when they are just low contrast on bright stickman at 0:05.
- **Impact:** Perceived missing captions if preview pill improves contrast but export has none — gold #FFD700 on bright background at 0:05 with stroke 4 may be low contrast without pill, looking invisible on thumbnail. Matches "NO captions at 0:05" — text present but invisible.
- **Suggested Fix:** Make preview match export: either remove ghost rect or add equivalent BackColour with low opacity when pill disabled. Document spec.
- **Reproduction:** Set Bold Drop, pillEnabled false, screenshot preview vs exported frame on white stickman background -> preview shows faint rect, export shows none, gold blends.

---

## [BUG-UI-9] Missing loading / error / empty handling for dims and segments — silent empty preview

- **File:** `src/components/editor/EditorShell.tsx`, lines 34-117; `src/components/editor/VideoPlayer.tsx`, lines 181-238, 446-451; `src/components/editor/CanvasOverlay.tsx`, lines 27-72
- **Severity:** High
- **Category:** Data / UI
- **Description:** Both EditorShell (lines 91-107) and VideoPlayer (lines 203-215) do `getVideoMetadata(blob).catch(()=>{})` swallowing errors with no toast/UI. If video 60 MB takes >8 s or decoding fails, `videoDims` stays null -> stage stays 16:9 (BUG-UI-1) with no "Failed to detect dimensions" message (ExportModal does show it at line 263 but EditorShell does not). Similarly CanvasOverlay `getActiveSegment` returns null when t outside [startMs-60,endMs+60] (canvasRenderer:159) -> it clearRects and shows empty, with no empty state. At 0:05 if no segment covers that time (gap before first word >80 ms per assGenerator:314, or currentTimeMs desync via two time sources), preview shows no captions but UI gives no indication — user assumes render bug, while export also generates gap Dialogue with all inactive (line 321) — captions present but invisible (inactive white AA 66% on white). No loading spinner for canvas font load either (loadGoogleFont fire-and-forget, line 165).
- **Impact:** Silent failure paths hide root cause of "NO captions at 0:05." User sees empty preview with no error, and export also empty with no warning.
- **Suggested Fix:** Surface videoDims loading/error state: show skeleton pillar with spinner, and error banner "Could not detect dimensions — export may be off-screen." Expose gap diagnostics: when getActiveSegment null at playhead, show timeline gap indicator.
- **Reproduction:** Load project, immediately seek to 0:05 before getVideoMetadata resolves -> canvas empty, no spinner. Throttle CPU 6x -> gap persists. Open ExportModal with same project -> error not shown until export attempt.

---

## [BUG-UI-10] Inconsistent dims thresholds between EditorShell and VideoPlayer — race leaves 16:9

- **File:** `src/components/editor/EditorShell.tsx`, line 95; `src/components/editor/VideoPlayer.tsx`, line 51, 207
- **Severity:** Low
- **Category:** Logic
- **Description:** EditorShell validates `w>=320 && h>=240` (line 95) before setVideoDims, VideoPlayer validates >=64 (line 51,207). A 240x426 vertical screen-record (common) would be accepted by VideoPlayer but rejected by EditorShell, leaving EditorShell videoDims null (so ExportModal gets undefined) while VideoPlayer shows correct pillar — export then throws "Missing video dimensions" (assGenerator:155) despite preview fine. Thresholds should match.
- **Impact:** Edge-case vertical low-res exports fail silently.
- **Suggested Fix:** Unify to >=64 or >=16 and share constant.

---

## [BUG-UI-11] Canvas text wrapping width differs from ASS — multiline position drift

- **File:** `src/lib/canvasRenderer.ts`, lines 212, 240-280, 302-344; `src/lib/assGenerator.ts`, lines 222-228, 264
- **Severity:** Medium
- **Category:** Logic / UI
- **Description:** Canvas wraps when needed > maxContentWidth (0.88*width) per-word measured with ctx.measureText including pop scale extra. ASS relies on PlayRes 1080x1920, WrapStyle:0, margins 10, and ScaledBorderAndShadow: yes to wrap via libass (no explicit max width). Canvas adds pillPadX/Y to rect but ASS uses BorderStyle 3 box without those paddings. Canvas also aggressively downscales effectiveBaseSize if totalBlockH > 0.45*canvasHeight (line 289) and again if maxLineW > maxContentWidth (line 324), whereas ASS clamps fontSize only once to 12-120 (line 181) with no height/wrap downscale. Result: 2-line captions in preview may be 3-line in export, baseY block centering drifts.
- **Impact:** At 0:05 the quick yellow LITTLE MORE (3 words?) stays 1 line in preview but 2 lines in export with narrow pillar 1080 -> second line may be at 0.84*1920+lineHeight pushing off bottom edge.
- **Suggested Fix:** Align wrapping: either compute line breaks in generateASS mirroring canvas (insert \N) or increase ASS MarginL/R to match 0.88 width, and replicate downscale.

---

## [BUG-UI-12] Dead code and swallowed catches hide caption render failures

- **File:** `src/components/editor/CanvasOverlay.tsx`, lines 82-85, 98-101; `src/context/EditorContext.tsx`, lines 389-395
- **Severity:** Low
- **Category:** UI / Logic
- **Description:** lastSegmentId/fadeOpacity/void fadeOpacity (line 84,117) retained for "future fade" but never used — dead branch for 200 ms fade spec. c.setTransform resets every draw but roundRect modern ctx.roundRect try/catch hides path errors. EditorContext video.play() catch swallows autoplay block and sets isPlaying false silently (line 383) with no toast. StylePanel loadGoogleFont fire-and-forget with no error UI if Google Fonts blocked by CSP/CORP (next.config require-corp blocks fonts.googleapis.com without CORP header).
- **Impact:** Future fade spec never ships; autoplay blocked on iOS shows paused UI with no hint; if fonts blocked, preview falls back to Inter but no warning that export is Arial Black.
- **Suggested Fix:** Remove dead fade vars or implement; promote font load failures to console.warn + UI badge.

---

## [BUG-UI-13] VideoPlayer videoUrl initialized via ref read during render — React ref rule violation

- **File:** `src/components/editor/VideoPlayer.tsx`, lines 71-83; `src/context/EditorContext.tsx`, line 235
- **Severity:** Low
- **Category:** Type / Logic
- **Description:** `const [videoUrl, setVideoUrl] = useState(() => { if (!videoBlob) return null; URL.createObjectURL(videoBlob) ... prevBlobRef.current = videoBlob })` reads videoBlob and mutates videoUrlRef/prevBlobRef during render (eslint react-hooks/refs error at line 73:59). React expects refs not read during render. On SSR this creates blob: URL on server (no document) then immediately revoked in effect, causing hydration mismatch and potential "blob 404" + MEDIA_ERR_SRC_NOT_SUPPORTED logs. Lint already flags 2 errors in this file (Cannot access refs during render, Calling setState synchronously within effect line 99). Also registerVideo called via callback ref setVideoRef may fire before videoUrl state set, causing el.src !== videoUrlRef.current mismatch and double load().
- **Impact:** Hydration warning, occasional black preview "Loading video..." stuck after fast project switch.
- **Suggested Fix:** Init videoUrl as null and create object URL in useEffect only (client), not in initializer.

---

## [BUG-UI-14] i18n hardcoded strings bypass translation system

- **File:** `src/components/editor/VideoPlayer.tsx`, lines 444, 449; `src/components/editor/EditorShell.tsx`, lines 162-170; `src/lib/canvasRenderer.ts`, line 15-33
- **Severity:** Low
- **Category:** i18n
- **Description:** User-facing strings Loading video..., No video blob available, No project, SPEED, Saved check, etc. are hardcoded English with no t() lookup. loadGoogleFont hardcodes https://fonts.googleapis.com without locale font fallback for RTL (isRtlLanguage in types) — RTL caption still rendered LTR if font lacks glyphs.
- **Impact:** Non-English users see untranslated editor; RTL captions may be mirrored but preview ctx.direction auto-detect via regex only, export ASS has no \q alignment for RTL.
- **Suggested Fix:** Route strings via i18n, add RTL \an mirroring.

---

## Cross-cutting hypothesis for 9:16 at 0:05

Chain: BUG-UI-1 (16:9 fallback) -> canvas sized to 16:9 box (BUG-UI-2) with half-size text on Retina (BUG-UI-3) -> preview *appears* to show "yellow LITTLE MORE at bottom" (actually centered over 16:9) while dims later snap to 9:16 without re-measuring content rect -> fullscreen or export PlayRes mismatch (BUG-UI-6) + font metrics diverge (BUG-UI-7) + ghost pill contrast (BUG-UI-8) -> exported ASS PlayRes 1080x1920 places MarginV 115 at bottom but first segment gap >80 ms (assGenerator gap handling) may insert inactive Dialogue at 0:05 with inactiveWordColor #FFFFFFAA (66% white) on bright stickman -> *perceived as no captions* even though file decodes. Verify via: console.log(videoDims, canvas.width, rect.width*dpr) during seek to 5 s, dump subtitles.ass head PlayResX/Y and first 5 Dialogue: lines.

Verify: await ffmpeg.listDir("/fonts"), inspect ffmpeg.on(log) for No usable font|Unable to open, ffprobe output.mp4.

---
*Generated read-only — no files modified. Run `npx tsc --noEmit` (clean) and `pnpm lint` (10 errors, see log) for confirmation.*
