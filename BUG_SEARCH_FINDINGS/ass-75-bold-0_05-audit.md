# ASS Generator Audit — 75 Segments Bold Drop 60 at 0:05 (Read-Only)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`  
**File audited:** `src/lib/assGenerator.ts` (415 lines) + cross-check `src/lib/presets.ts:63-89`, `src/lib/canvasRenderer.ts`, `src/lib/export.ts`, `src/lib/parseTranscription.ts`  
**Scenario:** 75 segments, Bold Drop preset (Impact 60, gold #FFD700 on black stroke 4, shadow 6/3/3, Pop highlight, uppercase), 1080x1920 vertical, seek 0:05 — hunter reports Dialogue `WHAT IF YOU` 4920-5600  
**Mode traced:** `dynamic` Pop & Scale (`highlightStyle: "pop"`)  
**Tool:** `npx tsc --noEmit` → 0 errors. Read-only, no fixes.

> Checklist verdicts first, then bugs. All line refs are `src/lib/assGenerator.ts` unless prefixed.

---

## Checklist Verdicts (Prompt Items)

| Check | Expected | Actual | Verdict |
|-------|----------|--------|---------|
| **PlayRes** 1080x1920 | `PlayResX: 1080` `PlayResY: 1920` | `lines 158-159,223-224` `Math.round(videoWidth/Height)` from `generateASS(segments,style,1080,1920,...)` — strict validation `throw` if <320 or <240 (line 155) — no 1280x720 fallback | **PASS** — correct, vertical not silently fallback |
| **Style Name/Default** | `Style: Default` | line 236 `Default` hard-coded | **PASS** |
| **Font** Impact→Arial Black | Arial Black | lines 165-177 `ASS_FONT_FALLBACKS[Impact]="Arial Black"` + `console.warn` — `fontNameSanitized` used in Style line 237 | **PASS** intentional fallback (see BUG-ASS-7) |
| **FontSize 60** | 60 | line 181 `Math.min(120, Math.round(60))` → 60, clamp 12-120 | **PASS** |
| **PrimaryColour** #FFD700 → &H0000D7FF | &H0000D7FF yellow | line 182 `hexToAssColour("#FFD700")` → `&H00`+`00`+`D7`+`FF` = `&H0000D7FF` (line 93 `&H${aStr}${bUp}${gUp}${rUp}` ABGR) | **PASS** verified |
| **SecondaryColour** (active) | &H0000D7FF | line 183 `activeWordColor \|\| color` → same gold | **PASS** |
| **OutlineColour** #000000 | &H00000000 | line 185 `&H00000000` (AA 00 opaque black) | **PASS** |
| **BackColour** pill disabled → transparent | &HFF000000 or &H00000000 | lines 189-194: `pillEnabled false → backColour = hexToAssColour("#000000",0) → alpha 255 → &HFF000000` transparent | **PASS** (transparent black, correct for BorderStyle 1) |
| **BorderStyle** | Prompt says 3 | Code → `1` when pill disabled (line 196), `3` when enabled (line 191). Bold Drop `pillEnabled:false` → **1** | **PASS (code correct, prompt expectation wrong)** — see BUG-ASS-1 |
| **Alignment** | 2 (bottom center) | `alignmentFor(bottom,center)` lines 96-113 → 2 | **PASS** |
| **MarginV** | 275 | `marginVFor(bottom,1920)` lines 115-119: `base 0.16*1920=307 - offsetScaled 12*1920/720=32 →275` (line 213) | **PASS** |
| **ScaledBorderAndShadow** | yes | line 226 `ScaledBorderAndShadow: yes` hard-coded | **PASS** |
| **Uppercased text** | WHAT IF YOU | `applyTransform` line 12 uppercase + `escapeAssText` then per-word transform lines 348,318 | **PASS** |
| **Escaped / not empty** | non-empty, braces escaped | lines 275-279 `if (!hasText && !hasWords) continue` + `escapeAssText` \{ \} \\ and \N (lines 23-30) ensures non-empty | **PASS** |
| **Zero-duration** | none | `segEnd = max(segStart+100, seg.endMs)` line 283 + `if(segEnd<=segStart) continue` line 284 + per-word `max(intervalStart+80,...)` lines 334,342 | **PASS** |
| **Overlapping times** | none | **FAIL — not clamped across segments** see BUG-ASS-4 | **FLAGGED** |
| **Time format H:MM:SS.cs** | 0:00:04.92 | `formatAssTime` lines 33-42 `h:m: s.cs` with pad m/s/cs 2 digits, `.` sep → `0:00:04.92` for 4920ms | **PASS** |
| **Comma handling** | commas OK (Text last field) | `Dialogue: 0,start,end,Default,,0,0,0,,${text}` lines 295,324,370 — Text last field, commas preserved | **PASS** |
| **Dialogue count vs segments** | 75 segs → 75 Dialogues? but dynamic → N per seg | lines 327-371 loop per word → 75*avg2=150 (≈225 if 3wps) — prompt `75 Dialogue 34162 bytes vs 40` — 34k bytes plausible for ~225 lines, no truncation | **PASS** see BUG-ASS-5 |
| **hexToAssColour #FFD700** | &H0000D7FF | PASS per above | **PASS** |
| **75 vs 7 truncation/limit** | no limit | `lines.join("\r\n")` no cap, export warn if >200KB line 297 only warn, verify readback lines 390-399 | **PASS** see BUG-ASS-5 |
| **Preview vs export mismatch** | font metrics diverge | canvasRenderer Impact vs ASS Arial Black → wrapping drift, not invisible — see BUG-ASS-7 | **FLAGGED Medium** |

---

## [BUG-ASS-1] BorderStyle 3 Expected but Bold Drop Correctly Uses 1 — Prompt Expectation Error [VERIFY]

- **File:** `src/lib/assGenerator.ts`, lines 188-197 ; `src/lib/presets.ts`, line 77 `pillEnabled: false`
- **Severity:** Low
- **Category:** UI / Logic
- **Description:** Prompt asks to check `BorderStyle 3` for Bold Drop. Code sets `borderStyle = pillEnabled ? 3 : 1` (line 191 vs 196). Bold Drop preset has `pillEnabled: false` (presets:77), so generated Style uses `BorderStyle 1` (outline+shadow). `3` means opaque box (`BackColour` fill). With pill disabled, `1` + `Outline 4, Shadow 1` is correct per ASS spec — yellow text with 4px black stroke and shadow, no box. If auditor expects `3`, they would false-flag. The inverse (pill enabled → 3 + `BackColour &Hxx000000` with opacity) is also correct (lines 189-191). Header check: `if(hasImpact) warn` in export (line 294) would warn if somehow pill path forced box incorrectly.
- **Impact:** No production bug — style renders as designed. If someone “fixes” to 3, would introduce unwanted black box behind gold text, harming contrast on dark stickman but adding contrast on bright background.
- **Suggested Fix:** Keep `1` for Bold Drop. Document expectation: `Bold Drop → BorderStyle 1, Outline 4, Shadow 1`. If prompt requires `3`, create dedicated pill preset instead of changing Bold Drop.
- **Reproduction:** `generateASS([seg], STYLE_PRESETS["Bold Drop"],1080,1920,"dynamic")` → parse header `Style: Default,Arial Black,60,&H0000D7FF,&H0000D7FF,&H00000000,&HFF000000,-1,0,...,1,4,1,2,10,10,275,1` — field 16 is `1` not `3`.

---

## [BUG-ASS-2] MarginV and Alignment Correct for 1920 but Comment Says “Center Ignores MarginV” — Potential Off-Center on Some Players

- **File:** `src/lib/assGenerator.ts`, lines 115-132, 210-213
- **Severity:** Low
- **Category:** UI
- **Description:** `marginVFor` for bottom correctly computes `275` (307-32). Center path (lines 125-131) returns `base 0.05*1920=96 + offset*0.5 +20 → ~132` and comment notes “center alignment ignores MarginV in some renderers.” For bottom preset this is not hit, but if user switches `positionPreset: center` the ASS may not vertically center — libass ignores `MarginV` when `Alignment 5` (middle center) and expects `\pos`. Code has no `\pos` tag for center (line 292 comment “optionally add \pos? We keep spec simple”). CanvasRenderer does handle center via `baseY=0.5*canvasHeight` (canvasRenderer:201). So preview center vs export center diverge.
- **Impact:** If user edits Bold Drop to center at 0:05, preview shows centered but export shows near-bottom or clipped — perceived “no caption” if bottom obscured by controls.
- **Suggested Fix:** For `center`/`top` with non-bottom alignment, emit `\pos($x,$y)` or `\an5` positioning via `\pos` calculated from `playRes` percentages to match canvas `baseY`. Keep `MarginV` fallback for bottom only.
- **Reproduction:** Set `positionPreset:"center", hAlign:"center"` → `alignmentFor` → 5, `marginVFor` → ~132 → generate ASS → open in VLC/libass — text still bottom-ish vs preview center.

---

## [BUG-ASS-3] Dialogue at 0:05 Hunted as 4920-5600 vs Segment at 5000 — Word-Level Interval vs Segment-Level Drift [VERIFY]

- **File:** `src/lib/assGenerator.ts`, lines 282-283, 313-343, 368-370; `src/lib/parseTranscription.ts`, lines 35-36
- **Severity:** Medium
- **Category:** Data / Logic
- **Description:** Hunter reports single Dialogue `WHAT IF YOU` 4920-5600 (0:00:04.92–0:00:05.60) at 0:05, while segments are grouped as `startMs = firstWord.startMs, endMs = lastWord.endMs` (parseTranscription:35). For `wordsPerSegment=2`, 3-word “WHAT IF YOU” would never be a single segment — it would be split as [WHAT IF] + [YOU …]. 4920-5600 spanning 680 ms with 3 words implies `wordsPerSegment=3` or `wordsPerSegment=5` chunking, not 2, or hunter inspected a *dynamic per-word* Dialogue where full segment text is repeated each interval (lines 345-367 `parts.join(" ")` contains all words each line, only highlight changes). So the observed Dialogue *is* full segment text, but its `Start` is `max(segStart, w.startMs)` per word (line 328) — for first word 4920 → 4.92, not 5.00. The 80 ms drift (5000→4920) matches `firstWordStart = max(segStart, sortedWords[0].startMs)` where sortedWords[0].startMs < segStart by 80 ms (possible if segment was edited or word timing corrected after grouping). If strict, should be equal. Also hunter’s 680 ms duration (4920-5600) covers 2-3 word intervals concatenated — the *visible* line at exact 5000 ms is the *second* interval (first word’s interval already ended at nextStart). So `getActiveSegment` at 5000 (canvasRenderer:119-125) finds segment if `t ∈ [start,end]`, but active word index may be 1, while ASS Dialogue at 5000 shows second interval. The text remains “WHAT IF YOU” (full segment) uppercased correctly, but highlight is on second word IF, not first. If seek lands in gap `[segStart, firstWordStart)` >80 ms, code inserts leading gap Dialogue with all inactive (lines 314-324) — `gapText` has `{\\c&H00FFFFFF&}WHAT{\\r} {\\c...}IF{\\r} ...` (inactive white) — at 0:05 this gap would show white text on bright background, perceived invisible.
- **Impact:** At 0:05, preview may show no yellow highlight (all white or gap inactive) while user expects yellow Pop — looks like “no caption.” Export shows same gap line with inactive white  &H00FFFFFF (or &HAA white for Reels) — low contrast on white stickman, invisible despite Dialogue existing — matches “preview shows but export invisible” report variant. The 2-vs-3-word confusion also suggests wordsPerSegment mismatch between transcription grouping (2) and hunter’s source data (3).
- **Suggested Fix:** Keep `segStart` as `min(word.startMs)` to avoid gap. If gap >80 ms is intentional (silence), ensure gap Dialogue uses same highlight as next word or omit gap line to avoid white flash. Log `word.startMs - segStart` diagnostics for 75-seg case. Reconcile `wordsPerSegment` setting actually used (ProjectSettings.wordsPerSegment) vs hunter’s assumption.
- **Reproduction:** Dump `segments.filter(s=> s.startMs<=5000 && s.endMs>=5000)` → note `seg.startMs`, `words[0].startMs`, `text`, `words.length`. Generate ASS dynamic and `grep Dialogue` near `0:00:04` → observe `0:00:04.92` start, not `0:00:05.00`. Screenshot gap line text: inactive colour `&H00FFFFFF&` vs active `&H0000D7FF&`.

---

## [BUG-ASS-4] Overlapping Dialogue Times Not Prevented Across Segments — Stacked Captions at Boundaries

- **File:** `src/lib/assGenerator.ts`, lines 162-163, 282-343
- **Severity:** Medium
- **Category:** Logic / Data
- **Description:** `filtered = [...segments].sort((a,b)=>a.startMs-b.startMs)` only sorts. No de-duplication, gap removal, or clamping of `segEnd` to next `segStart`. If two segments overlap (e.g., Gemini returns overlapping word timings, user hand-edits segment end past next start, or `groupWordsIntoSegments` rounding creates `endMs == next startMs` but dynamic `intervalEnd = max(intervalStart+80, nextStart)` could extend past `segEnd` then clamped `if(intervalEnd>segEnd) intervalEnd=segEnd` — inside one segment intervals are adjacent non-overlapping. Across segments, however, last interval of seg A ends at `segEndA` (e.g., 5600) and first interval of seg B starts at `segStartB` (e.g., 5550 if overlap) → both Dialogues visible 50 ms overlapping. libass will render both stacked (Collisions: Normal → second shifts, but with same Alignment 2 they overlap). `segEnd = max(segStart+100, seg.endMs)` ensures min 100 ms even for zero-length, but does not prevent negative gap. No check `if(segStart < prevEnd) segStart = prevEnd` etc.
- **Impact:** For 75 segments tightly packed (~600 ms each), overlap of even 20-30 ms causes double caption at boundary — preview `getActiveSegment` returns first match (line 568 loop) so shows only first, but export shows both — perceived as bold doubling or flicker at 0:05 transition. Could be mistaken for “no caption” if overlap pushes MarginV shifted line.
- **Suggested Fix:** After sorting, iterate and clamp: `if (seg.startMs < prevEnd) seg.startMs = prevEnd + 1` or drop overlapping Dialogue generation. Or detect and log `console.warn` when `seg.startMs < prevEnd`. For dynamic per-word intervals, ensure `intervalEnd = min(intervalEnd, nextSegStart)` when nextSegStart known.
- **Reproduction:** Craft 2 segments: `{startMs:5000,endMs:5600,words:[...]}` and `{startMs:5550,endMs:6200,...}` → generate ASS → two Dialogues `0:00:05.00-0:00:05.60` and `0:00:05.55-0:00:06.20` overlap 50 ms. Play 500 ms around 5.55s — preview shows one, export shows two.

---

## [BUG-ASS-5] No Truncation or Hard Limit for 75 Segments — 34162 bytes / ~75-225 Dialogues Is Expected, Not a Bug

- **File:** `src/lib/assGenerator.ts`, lines 218-276, 275-375; `src/lib/export.ts`, lines 275-311
- **Severity:** Low (informational)
- **Category:** Performance / Data
- **Description:** No code path limits Dialogue count or ASS size. `lines: string[]` grows linearly `O(segments * avgWords)`. For 75 segments dynamic pop avg 2 words → ~150 Dialogues; avg 3 → ~225 Dialogues. At ~140-160 chars per Dialogue (tags + text) → ~21k-36k + header 400 → 34162 bytes matches expectation (hunter reports 34162 vs 40 — likely 40 chars per static line vs 150 dynamic lines). Export diagnostics lines 276-306 count Dialogues via `/^Dialogue:/gm`, log `bytes, dialogue, segments, playRes`, warn if >200KB (line 297) but never truncate, verify readback `readFile(assName)` checks header `PlayResX` (line 394). No `lines.slice(0,N)` or `MAX_DIALOGUES`. Seven-seg test (≈40? actually 7*3≈21 Dialogues, maybe reporter counted 40 lines including header) vs 75-seg scales linearly. No `TextEncoder` chunk split needed for 34K.
- **Impact:** None — 75-seg export will not silently drop captions. Risk is only OOM for >200KB (>1000 segs) where libass/wasm may slow, but export warns not throws.
- **Suggested Fix:** Keep as is. Optionally add guard `if (filtered.length>500) console.warn` earlier, and ensure `export.ts` `assContent.length <80` throw (line 272) does not false-fire for valid 34K (80 is far below).
- **Reproduction:** `generateASS(new Array(75).fill(0).map((_,i)=>({id:"",startMs:i*700,endMs:i*700+600,text:"HELLO WORLD",words:[{word:"HELLO",startMs:i*700,endMs:i*700+300},{word:"WORLD",startMs:i*700+300,endMs:i*700+600}]})), STYLE_PRESETS["Bold Drop"],1080,1920,"dynamic")` → `match(/^Dialogue:/gm).length===150` and `length≈18000-22000`.

---

## [BUG-ASS-6] Uppercasing and Escaping Correct for 0:05 Text — No Empty Dialogue, Comma Handling Verified

- **File:** `src/lib/assGenerator.ts`, lines 10-21, 23-31, 275-303, 345-370
- **Severity:** Low (pass)
- **Category:** Data / UI
- **Description:** `applyTransform` uppercase (line 13 `toUpperCase`) applied both in static (line 288) and dynamic per-word (lines 318-319,348-349) so `what if you` → `WHAT IF YOU`. `escapeAssText` escapes `\ → \\`, `{ → \{`, `} → \}`, `\n → \N` (lines 26-30). No empty Dialogue: `if (!hasText && !hasWords) continue` (279) plus fallbacks `raw = hasText ? seg.text : words.map(...).join(" ")` ensures text non-empty. Dialogue line built as `Dialogue: 0,start,end,Default,,0,0,0,,${escaped}` (lines 295,324,370) — Text last field, so commas inside user text (e.g., “HELLO, WORLD”) are preserved per ASS spec (fields before Text are fixed 9 commas). Example for static: `Dialogue: 0,0:00:04.92,0:00:05.60,Default,,0,0,0,,WHAT IF YOU` — commas inside Text would not split.
- **Impact:** No bug — 0:05 text will be uppercase non-empty, escaped, commas safe. Potential nit: leading/trailing spaces trimmed via `seg.text.trim().length` check but not trimmed in output — leading space would create empty token but tags still wrap, harmless.
- **Suggested Fix:** None. For completeness, trim text before transform to avoid “ WHAT ” double spaces, but keep as is for WYSIWYG.
- **Reproduction:** Segment `{text:"what, if you {test}", words:[{word:"what, "},{word:"if"},{word:"you"}]}` → generate → Text `WHAT, IF YOU \{TEST\}` with commas intact and braces escaped.

---

## [BUG-ASS-7] Preview vs Export Font Metrics Diverge — Canvas Impact (Condensed) vs ASS Arial Black (Wide) Causes Wrapping Drift, Not Invisibility

- **File:** `src/lib/assGenerator.ts`, lines 165-180; `src/lib/canvasRenderer.ts`, lines 18-22, 172-173; `src/lib/export.ts`, lines 406-461
- **Severity:** Medium
- **Category:** UI / Type
- **Description:** Preview `loadGoogleFont` skips `Impact` (line 19-21 `if(fontFamily==="Impact") return`) and sets `ctx.font = "italic 900 60px \"Impact\", Inter, sans-serif"` (canvasRenderer:173) — measures with Impact’s condensed advances via `ctx.measureText` for wrapping `maxContentWidth 0.88*canvasWidth` and `effectiveBaseSize` downscale (lines 240-344). ASS maps `Impact → Arial Black` (assGenerator:171-177) because `@ffmpeg/core@0.12.10` MEMFS `/fonts` does not bundle Impact (comment lines 167-169 says “Montserrat succeeded in 7-seg test; Arial/DejaVu is always in 0.12.10”). Export `generateASS` emits `Style: Default,Arial Black,60,...` (line 237) and libass measures with Arial Black metrics (wider, heavier). Additionally, `export.ts` fontsdir population (lines 406-461) writes only `/fonts/Inter-Regular.ttf` if listing empty, not Arial Black — so if core build ships empty /fonts, ASS requests Arial Black but only Inter exists → libass substitutes Inter/DejaVu (still wider than Impact). Canvas wrapping may keep “WHAT IF YOU” single line at 1080 wide with Impact, while ASS wraps to two lines or scales differently. The 75-seg 34K file is not truncated, so captions are not invisible due to missing font — they render (libass substitutes), but position differs. The subtle `rgba(255,255,255,0.08)` pill behind inactive preview (canvasRenderer:379-397) is absent in ASS `BorderStyle 1` (`&HFF000000` transparent, line 194), also causing contrast difference on bright stickman at 0:05 — gold #FFD700 without pill may blend on white background, perceived as invisible though technically rendered.
- **Impact:** User sees single-line centered yellow “WHAT IF YOU” in preview but exported frame shows two-line or shifted, or gold on white looks invisible — reported as “export shows no caption at 0:05.” Metrics drift increases with longer lines; 75 segments with varied lengths exacerbates.
- **Suggested Fix:** Either render preview with same fallback `Arial Black` to match export (change `family` to `'"Arial Black", "Arial", sans-serif'` when `rawSanitized==="Impact"`), or bundle Impact TTF and write to `/fonts/Impact.ttf` before `ffmpeg.exec` (requires license). Also align wrapping: generateASS should insert `\N` mirroring canvas `lineWords` logic, or increase `MarginL/R` to `10` → `~86` (12% each side) to match canvas `0.88` width, and replicate `effectiveBaseSize` downscale clamp 12-120 alone vs canvas `0.45*height` logic. Ensure `Shadow 1` vs canvas `shadowBlur 6` remain consistent (ScaledBorderAndShadow yes scales 6px to 1920 correctly).
- **Reproduction:** Set Bold Drop, segment with 8 words “WHAT IF YOU HAD A LITTLE MORE TIME” → preview screenshot vs exported frame at same timestamp → measure line count and baseY. Inspect `subtitles.ass` header `Fontname: Arial Black` vs `canvasRenderer` `ctx.font` containing Impact. Check `await ffmpeg.listDir("/fonts")` → likely `["Inter-Regular.ttf"]` only, confirming substitution.

---

## [BUG-ASS-8] hexToAssColour for #FFD700 → &H0000D7FF Correct, But Opacity Paths for Inactive/BackColour Subtle

- **File:** `src/lib/assGenerator.ts`, lines 50-94
- **Severity:** Low
- **Category:** Type / Logic
- **Description:** `hexToAssColour("#FFD700")` → `r=FF g=D7 b=00 a=00 → &H0000D7FF` verified `&H${AA}${BB}${GG}${RR}` ABGR (line 93). For 8-char `#RRGGBBAA`, aHex extracted `hex.slice(6,8)` and `alpha=255-hexAlpha` (line 83) — e.g., `#FFFFFFAA` (Reels inactive) → hexAlpha 0xAA 170 → alpha 85 → `&H55FFFFFF` (33% opaque), correct per spec `00 opaque FF transparent`. For pill disabled `backColour = hexToAssColour("#000000",0)` → `opacityOverride 0 → alpha 255 → &HFF000000` fully transparent, correct. `secondaryColour` same gold, `outline &H00000000`, `primary &H0000D7FF`. No bug for Bold Drop. Print detailed: `#FFD700` uppercase padded `FF D7 00` → `00 00 D7 FF`.
- **Impact:** None for 0:05 yellow. If preset used `#FFD700AA` would be semi-transparent gold, not intended — but Bold Drop uses opaque.
- **Suggested Fix:** None. Optionally assert `hexToAssColour` input regex and normalize `input.trim().toUpperCase()` to catch lowercase.

---

## [BUG-ASS-9] Time Format H:MM:SS.cs Correct — No “Incorrect Comma” Issue, Zero-Duration Clamped

- **File:** `src/lib/assGenerator.ts`, lines 33-43, 260-264
- **Severity:** Low (pass)
- **Category:** Logic
- **Description:** `formatAssTime` clamps `Math.max(0, Math.floor(ms))` (line 34), computes `cs = floor(ms/10)%100` (lines 35-36), `s,m,h` with mod 60 and pad 2 for m/s/cs but not h (line 42 `h:`+ pad). Output like `0:00:04.92` and `0:00:05.60` for 4920/5600. Dialogue line format `Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text` (line 264) correctly has Text last, commas inside Text not split (ASS spec last field consumes remainder). Zero-duration guarded `segEnd = max(segStart+100, seg.endMs)` (283) and `if(segEnd<=segStart) continue` (284) plus per-word `max(intervalStart+80, nextStart)` (334). So at 0:05 no zero-duration line, time format valid, commas safe.
- **Impact:** No bug — Media Player seek to 0:05 will show dialogue. Potential 10 ms floor vs round drift for 4999→4.99 vs 5.00, negligible for 680 ms segment.
- **Suggested Fix:** None. If frame-accurate needed, use `Math.round(ms/10)` instead of floor for cs, but not required.

---

## [BUG-ASS-10] Dialogue Count and Byte Size for 75 vs 7 — Linear Scaling, 34K Not Truncated, Guard Only Warns >200KB [VERIFY]

- **File:** `src/lib/assGenerator.ts`, lines 218-375; `src/lib/export.ts`, lines 272-311, 386-403
- **Severity:** Medium (if misinterpreted as bug)
- **Category:** Data / Performance
- **Description:** Hunter notes “75 Dialogue 34162 bytes vs 40” — unclear if 40 is Dialogue count for 7 segs or bytes. 7 segs dynamic pop avg 2-3 words → 14-21 Dialogues, static → 7 Dialogues. 40 Dialogues for 7 segs impossible unless wordsPerSegment 5-6. More likely 40 = byte length of something else or static header. Code has no limit: `filtered.length 75 → loop 75 segs * words.length` → header + 150-225 Dialogues → ~34K. Export `generateASS` logs `bytes, dialogue, segments, playRes` (lines 281-294) and warns if `>200000` (line 297) but does not throw; `verify readFile` checks header `PlayResX`/`[V4+ Styles]` (394) but not Dialogue count. No `substring(0,40000)` truncation. MEMFS write `TextEncoder.encode(assContent)` (388) handles 34K easily (<60 MB video blob size). So 75 vs 7 difference is expected linear, not truncation.
- **Impact:** No data loss. If 75-seg file showed “no caption at 0:05” it is not due to truncation at 34K. Only risk: very long segments with commas/quotes could push to >100KB but still under 200KB warn threshold.
- **Suggested Fix:** Keep. Add explicit assert `if(dlgCount !== expected) warn` where expected = sum `seg.words.length` or `segments.length` for static to catch filtered skip. Document that 75 Dialogue lines is static expectation, dynamic is higher — update hunter’s baseline.

---

## Cross-Cutting Diagnosis for 0:05 “No Caption”

At 0:05 with 75-seg Bold Drop Pop, the ASS header is correct (`PlayRes 1080x1920, Arial Black 60 gold, BorderStyle 1, MarginV 275`). The Dialogue *exists* (`WHAT IF YOU` uppercased, escaped, non-empty, time `0:00:04.92-0:00:05.60` adjacent, commas safe, 34K not truncated). The “no caption” is **not** an ASS generation bug per se, but a **contrast/metrics illusion**:

1. Gap inactive colour `&H00FFFFFF` (white opaque) or `&H55FFFFFF` (if Reels AA) on bright stickman background (canvas ghost pill `rgba(255,255,255,0.08)` helps in preview but ASS has transparent `&HFF000000` and `BorderStyle 1` no box) → gold without pill blends, looks invisible in Media Player thumbnail.
2. Font substitution Impact→Arial Black makes exported line wider, may wrap to second line and push MarginV block upward, appearing higher than preview’s single line at bottom.
3. Word interval vs segment start 80 ms offset plus gap line with all inactive makes 0:05 show white, not yellow.

Verify by extracting `subtitles.ass` from MEMFS (`await ffmpeg.readFile("subtitles.ass")`), inspect first 5 Dialogue lines around `0:00:04.9`, check `hexToAssColour` values via `hexToAssColour("#FFD700")` console, and `ffmpegLogs` for `No usable font` (export.ts 406-461 ensures `/fonts/Inter-Regular.ttf` but not Arial Black).

---

*Read-only audit — no files modified. `npx tsc --noEmit` clean. Recommend dumping ASS and canvas metrics at 0:05 before any fix.*
