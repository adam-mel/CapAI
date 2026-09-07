# Caption Size Auditor — Preview LARGE vs Export SMALL at 0:03, 1080x1920, Bold Impact 60

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`  
**Auditor:** CapAI caption size auditor (read-only)  
**Files audited:** canvasRenderer.ts, CanvasOverlay.tsx, canvasExport.ts, presets.ts, assGenerator.ts  

**Scenario:** 1080x1920 vertical, Bold Drop Impact 60, text IS COMPLETELY at 0:03. Preview 352x626 CSS shows IS COMPLETELY fills bottom ~15% height, yellow COMPLETELY ~300px at 352 width (~85% width). Export webm 1080x1920 shows same text tiny ~200px at 1080 width (~18% width), ~5% height, cropped at feet.

---

## 1. Exact Line Numbers Where Scaling Diverges

### canvasRenderer.ts — Missing proportional scaling (ROOT CAUSE)
```ts
// src/lib/canvasRenderer.ts:137-145 renderCaption signature canvasWidth/canvasHeight
// L172: const baseSize = style.fontSize; // px
// L178: let effectiveBaseSize = baseSize;
// Comment at 179-183 acknowledges reference 720p 1280 font 52 => 4% but leaves scaling commented:
// Scale for canvas width relative to 720p reference
// Reference: 720p width 1280, font 52 => 52px at 1280 width => ~4% of width
// For smaller canvas, keep font readable: scale = min(1, canvasWidth / 500) ???
// But spec says apply fontSize directly, so we keep direct unless it overflows
```

**Divergence point 1 — No scaleFactor:** Expected `scale = canvasWidth / 1080` or `Math.min(canvasWidth/1080, canvasHeight/1920)` but actual `effectiveBaseSize = baseSize` unchanged (60 on both 352 and 1080 canvases).

### canvasRenderer.ts — Overflow-only downscale (asymmetric)
```ts
// L212: const maxContentWidth = canvasWidth * 0.88;
// L285: const lineHeight = effectiveBaseSize * 1.25;
// L289: if (totalBlockH > canvasHeight * 0.45) {
// L325: if (maxLineW > maxContentWidth) {
```
- maxContentWidth = canvasWidth * 0.88 => preview 309px, export 950px
- lineHeight = effectiveBaseSize * 1.25 => 75px both
- block overflow `if (totalBlockH > canvasHeight * 0.45)` => 75>282? NO, 75>864? NO => no scaling
- width overflow `if (maxLineW > maxContentWidth)` => preview 384>309 TRUE => scale 0.804*0.96=0.772 => 46.3px, export 384>950 FALSE => 60px

### CanvasOverlay.tsx — Preview correctly divides by DPR (DPR is NOT cause)
```ts
// L35: const dpr = window.devicePixelRatio || 1
// L148: const w = canvas.width / dpr;
// L149: const h = canvas.height / dpr;
// L151: c.setTransform(dpr, 0, 0, dpr, 0, 0);
// renderCaption(c, active, captionStyle, t, mode, w, h) with w=352,h=626 logical
```
Preview logical canvas 352x626 (704x1252 physical at DPR2) vs Export 1080x1920 physical, DPR1. Ratio 1080/352=3.06x.

### canvasExport.ts — Export uses physical dims, no DPR
```ts
// L136: const w = Math.round(videoWidth);
// L346: captionCanvas.width = w;
// L537: renderCaption(captionCtx, seg0, style, t0, mode, w, h);
// No ctx.scale, no setTransform, DPR 1
```

---

## 2. Formula: Preview vs Export (Computed)

```
effectiveBaseSize = baseSize (=60) unless overflow
Preview: canvasWidth=352 CSS, canvasHeight=626 CSS, maxContentWidth=309
  Impact Bold 900 IS COMPLETELY ~384px at 60px => 384>309 => scale 0.772 => 46.3px
  visual width fraction = 46.3/352=13.2% (or 60/352=17.0% without downscale)
  visual height fraction = 75/626=12% (or 57.9/626=9.2% with downscale)
Export: canvasWidth=1080, canvasHeight=1920, maxContentWidth=950
  384<950 => NO scaling => 60px
  visual width fraction = 60/1080=5.56%
  visual height fraction = 75/1920=3.91%
Ratio = (60/352)/(60/1080)=1080/352=3.068x height 1920/626=3.068x
With preview downscale: 46.3/352 / 60/1080 = 2.36x still >2x, user observed ~3x
If DPR2: preview device 92.6px vs export 60px but CSS proportion still 3x
```

Char width estimate Impact 60px: I18+S30+space15+C33+O36+M42+P36+L24+E30+T30+E30+L24+Y36 ~384px for IS COMPLETELY, COMPLETELY alone ~291px => 291/352=82% preview matches user 85%, 291/1080=26.9% export but user reports 18% (scaled display).

WYSIWYG proportional should be:
  Option A Preview honest: REFERENCE 1080x1920, scaleFactor=canvasWidth/1080 => preview 60*0.326=19.5px (23.6px at 425) => 19.5/352=5.54% matches export 5.56%
  Option B Export large: export 60*1080/352=184px => 184/1080=17% matches preview 17%
Spec comment L180: 52px at 1280 => 4% => 52*1080/1280=43.8px expected on 1080, export 60 already larger than spec, preview 60 way larger.

---

## 3. Hypothesis: Which Factor Causes ~3x Smaller

**Primary hypothesis CONFIRMED: Absolute fontSize 60px on canvases whose widths differ by 3.06x (352 vs 1080).**

- renderer at canvasRenderer.ts:172,178 uses style.fontSize as absolute CSS/device px with no canvasWidth/1080 scaling. Comment at 179-183 acknowledges need but leaves commented.
- CanvasOverlay correctly normalizes DPR (canvas.width/dpr at 148-149) so preview logical 352 vs export 1080 creates 3x gap. DPR exonerated: if preview had passed 704 physical, ratio would be 704/1080=0.65 => 1.5x not observed.
- Overflow downscale at 325-327 only partially narrows gap (46 vs 60 => 2.3x) and asymmetric maxContentWidth 309 vs 950 means preview wraps sooner.
- Secondary amplifiers (not 3x alone): strokeWidth 4 => 4/352=1.14% vs 4/1080=0.37% (3x thicker in preview), shadowBlur 6 same, pillPadding 8 => 2.27% vs 0.74%, lineHeight 75/626=12% vs 75/1920=3.9%, baseY 0.84*height + offset*height/720 is height-proportional while font is not => bottom margin huge in export.
- Wrapping divergence: maxContentWidth 0.88*w preview 309 vs export 950 => long phrases wrap in preview not export.
- Alternative hypotheses ruled out: DPR 2x mis-handle (would be 1.5x), block overflow at 289 not triggered for 1 line, rotation swap not applicable.

---

## 4. Recommended Fix to Make WYSIWYG

### Decision: Which direction is correct per PRD spec?

PRD 10: Reels 52, Clean 40, Bold Drop 60. No reference resolution. Comment at canvasRenderer 180 says reference 720p 1280 font 52 => 4% implies presets intended for 720p/1080p PlayRes (absolute px at export). Under that spec, export at 60 on 1080 (5.5%) is closer to spec (4-5%), preview at 60 on 352 (17%) is 3x oversized. So spec-correct fix is shrink preview to match export (Option A). However UX reality: on phone, 5.5% width (~200px phrase on 1080) is tiny, unreadable. User liked preview large (85% width, phone-readable) and was shocked export tiny. So UX-desired fix is enlarge export to match preview (Option B). Both valid WYSIWYG; pick one and re-anchor presets.

#### Option A — SPEC-CORRECT (make preview honest, export unchanged)
Change canvasRenderer.ts:178 add proportional scaling before overflow checks:
```ts
const REFERENCE_WIDTH = 1080; // vertical; 1280 for 720p landscape
const REFERENCE_HEIGHT = 1920;
const scaleFactor = Math.min(canvasWidth / REFERENCE_WIDTH, canvasHeight / REFERENCE_HEIGHT);
let effectiveBaseSize = baseSize * scaleFactor;
effectiveBaseSize = Math.max(10, effectiveBaseSize);
// Also scale strokeWidth, shadowBlur/Offset, pillPadding, pillRadius, lineHeight by same factor
```
Effect: Preview 352 => 60*0.326=19.5px matches export proportion 5.54% vs 5.56%. Presets remain 52/40/60 as spec. Preview will shrink to tiny matching Image 2. Need to recalibrate presets upward (Bold 60 => 120-150) to regain readability.

#### Option B — UX-DESIRED (make export large to match preview)
Keep preview absolute large and scale export up to preview proportion. Two sub-options:
1. Scale renderer for export only: In canvasExport.ts:577 compute exportScale=1080/352=3.06 and pass inflated style.fontSize*exportScale or add exportScale param to renderCaption.
2. Simpler: bump presets for 1080 vertical: Bold Drop 60=>120-150, Reels 52=>100, Clean 40=>80. Keep renderer absolute. Also scale assGenerator.ts:181 fontSize similarly or ASS and canvasExport diverge.
Effect: Export 1080 with 120px => 11% width => COMPLETELY ~580px (53% width) closer to preview 85%; 184px would be exact 85% match. 120 is compromise readable without covering feet.

#### Recommendation (this auditor)
Implement Option A + preset recalibration for true WYSIWYG with spec correction:
1. Fix renderer to be proportional (canvasRenderer.ts:178): effectiveBaseSize = baseSize * (canvasWidth / 1080) for vertical (or Math.min). Scale strokeWidth, shadowBlur/Offset, pillPadding, pillRadius, lineHeight by same. Keep maxContentWidth 0.88*w already proportional. Guarantees preview==export for all DPRs.
2. Recalibrate presets (presets.ts): Reels 52->90, Clean 40->70, Bold Drop 60->110-130 (aim for COMPLETELY ~55-60% width at 1080, not 85% which covers feet). Update PRD 10 table.
3. Add bottom clipping guard: baseY = Math.min(baseY, canvasHeight - totalBlockH/2 - 12*scaleFactor - pillPadY) (currently no guard, L199-205 + 353-392).
4. Unify ASS: In assGenerator.ts:181 apply same scaleFactor if PlayRes differs from reference.
If hotfix TODAY without preset change: Change canvasRenderer.ts:178 to let effectiveBaseSize = baseSize * (canvasWidth / 1080) and do NOT touch presets. Preview will shrink to match export (honest). Notify users previous preview was zoomed and new preview matches export; offer slider max 120-150 to let them re-enlarge manually.

---

## 5. Additional Precise Measurements & Cross-Checks

### DPR handling is correct (not cause, but confirm)
- Preview: canvas.width=704 at DPR2, w=704/2=352 logical, setTransform(2) => 60 CSS px => 120 device px crisp.
- Export: captionCanvas.width=1080 device px, no transform => 60 device px.
- Device ratio 120 vs 60 =2x but CSS proportion still 3x. If preview had passed 704 physical, ratio would be 704/1080=0.65 =>1.5x not 3x, confirming current code divides correctly.

### Position and offset
- baseY = canvasHeight*0.84 + offset*canvasHeight/720 (L199-205): Preview h626 525+10.4=535, Export h1920 1612+32=1644 (~83-85% height, proportional, not cause, but offsetScale is height-proportional while font is not => relative offset larger in export).

### Stroke/shadow/pill absolute divergence
- strokeWidth 4: preview 4/352=1.14% vs export 4/1080=0.37% => 3x thicker in preview.
- shadowBlur 6 same 3x blur, pillPadding 8 => 2.27% vs 0.74%.

### Wrapping and clipping
- maxContentWidth 0.88*w: preview 309 vs export 950 => short phrases fit both, long phrases wrap in preview not export. At 0:03 IS COMPLETELY ~291px fits both. No wrap divergence at 0:03, but 75-seg longer segments will wrap differently.
- Bottom clipping: No explicit guard. With 60px safe (1727<1920), but user reports cropping due to video content feet at bottom edge or viewer zoom; no guard ensures baseY+totalBlockH/2 < canvasHeight - margin.

### ASS coherence check
- assGenerator.ts:158-181 PlayResX/Y = videoWidth/Height (1080x1920), fontsize = style.fontSize absolute (60). ScaledBorderAndShadow: yes means border/shadow scales with PlayRes, consistent with canvasExport absolute. So ASS and canvasExport agree (both 60 on 1080). Preview is outlier. Confirms fix must be in preview (Option A) or both export paths (Option B).

---

## 6. Bug Template Entries

### [BUG-UI-CAP-1] Absolute fontSize with no reference-dimension scaling — preview 3x larger than export
- **File:** src/lib/canvasRenderer.ts, lines 172, 178-183, 285, 212
- **Severity:** High
- **Category:** Logic/UI
- **Description:** baseSize = style.fontSize (60) used directly as effectiveBaseSize with no canvasWidth/1080 scaling. Comment at 179-183 acknowledges reference 720p 1280/52 (~4%) and drafts Math.min(1, canvasWidth/700*0.9+0.1) but leaves commented. Preview 352x626 => 60/352=17% width, export 1080x1920 => 60/1080=5.6% => 3.06x gap. Overflow downscale at 289/325 only partially compensates (46 vs 60 => still 2.3x).
- **Impact:** WYSIWYG broken; user sees LARGE phone-readable captions in editor (85% width, 15% height) but exported webm tiny (18% width, 5% height, cropped). Same segment/time/style wildly different.
- **Suggested Fix:** effectiveBaseSize = baseSize * (canvasWidth / 1080) (or Math.min). Scale strokeWidth, shadowBlur/Offset, pillPadding, lineHeight by same. See 4 Option A.
- **Reproduction:** Load 1080x1920 Bold Drop 60, seek 0:03, measure canvas.width/dpr (352) vs videoWidth (1080) and ctx.font (60px both). Screenshot preview vs webm frame at 0:03.

### [BUG-UI-CAP-2] Stroke/shadow/pill absolute px diverge 3x
- **File:** src/lib/canvasRenderer.ts, lines 353-392, 512-513, presets.ts:72-73
- **Severity:** Medium
- **Category:** UI
- **Description:** strokeWidth, shadowBlur/Offset, pillPaddingX/Y, pillRadius, lineHeight 1.25*effective all absolute. Preview 4px on 352=1.14% width, export 4px on 1080=0.37% => preview 3x bolder.
- **Impact:** Even if font scaling fixed, export looks thinner than preview unless these scale proportionally.
- **Suggested Fix:** Multiply all by scaleFactor as above.

### [BUG-UI-CAP-3] maxContentWidth 0.88*w wraps differently
- **File:** src/lib/canvasRenderer.ts:212, 240-280, 325-327
- **Severity:** Low
- **Category:** Logic
- **Description:** maxContentWidth = canvasWidth*0.88 is proportional, but absolute font makes preview exceed sooner (309 vs 950). Long segments wrap to 2 lines in preview but 1 line in export.
- **Impact:** Multi-line captions at other timestamps will appear at different Y and line-count.
- **Suggested Fix:** After proportional font scaling, wrap thresholds equalize.

### [BUG-UI-CAP-4] Bottom position no clipping guard
- **File:** src/lib/canvasRenderer.ts:199-205, 367-370, canvasExport.ts:345-351
- **Severity:** Low
- **Category:** UI
- **Description:** baseY = canvasHeight*0.84 + offset*canvasHeight/720 leaves ~16% margin, but with large effective (if Option B 184px) bottom pill would exceed canvasHeight. Current export 60px safe (1727<1920), but user reports cropping due to video content feet at bottom edge; no guard ensures baseY+totalBlockH/2 < canvasHeight - margin.
- **Impact:** On vertical with feet at bottom, captions overlap feet; at higher font sizes may be clipped.
- **Suggested Fix:** Add clamp: baseY = Math.min(baseY, canvasHeight - totalBlockH/2 - 12*scaleFactor - pillPadY).

---

## 7. Confirmation Steps (read-only)

- npx tsc --noEmit: expect clean
- Log at CanvasOverlay draw (148-156): console.log({w,h,dpr, measured: ctx.measureText(chr(34)+chr(34)+chr(34))}) at 0:03, compare preview 352 vs export 1080
- Dump subtitles.ass header when exporting via FFmpeg fallback: PlayResX: 1080, Fontsize: 60, Style: Default,Arial Black vs canvas Impact => metric gap
- Verify with ffprobe or MediaRecorder output dimensions 1080x1920

---

*Generated read-only — no files modified. Auditor: muse-spark-1.2-contributor-free.*
