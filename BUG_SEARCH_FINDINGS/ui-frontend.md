# CapAI UI & Frontend Bug Hunt — Findings

**Scope:** src/app, components/editor+dashboard+layout+modals+ui, hooks, context, store, lib/utils, globals.css

**Date:** 2026-09-07 — read-only scan, tsc 0 errors, lint no src hard errors

---

## [BUG-UI-1] Missing error state on dashboard
- **File:** src/hooks/useProjects.ts, line 19-33
- **Severity:** High
- **Category:** Data / UI
- **Description:** liveQuery error only console.error + setLoading(false). Hook exposes projects, loading no error. page.tsx:194 renders loading?skeleton:projects.length===0?EmptyState:ProjectGrid -> after DB error shows EmptyState misleading.
- **Impact:** Empty dashboard on error.
- **Suggested Fix:** Expose error, render ErrorState with Retry.

## [BUG-UI-2] Dashboard hidden file input aria-hidden + tabIndex=-1
- **File:** src/app/page.tsx, line 136-146
- **Severity:** High
- **Category:** UI / Accessibility
- **Description:** input aria-hidden true tabIndex -1 class hidden is only mechanism for New Project. Assistive tech cannot discover.
- **Impact:** WCAG 2.1.1 blocked keyboard users.
- **Suggested Fix:** Keep sr-only not hidden, or label htmlFor.

## [BUG-UI-3] Duplicate header file inputs race
- **File:** src/components/layout/SiteHeader.tsx, line 22-71 ; src/app/page.tsx, line 28-41
- **Severity:** Medium
- **Category:** Logic / Data
- **Description:** Both inputs dispatch setPendingFile -> capai:open-quick-settings. Both may receive file, singleton overwritten.
- **Impact:** Double modal.
- **Suggested Fix:** Single source SiteHeader.

## [BUG-UI-4] Editor page conflates DB error vs not found
- **File:** src/app/projects/[id]/page.tsx, line 24-52, 72-90
- **Severity:** High
- **Category:** Data / UI
- **Description:** catch -> setNotFound(true) maps any exception to 404. if (!project) return null flashes blank.
- **Impact:** Transient errors look permanent.
- **Suggested Fix:** Separate error state.

## [BUG-UI-5] Processing initKeys swallowed
- **File:** src/app/projects/[id]/processing/ProcessingClient.tsx, line 66-70, 180-182
- **Severity:** Medium
- **Category:** Logic
- **Description:** try {initKeys()} catch {} swallows migration errors, attemptLog stays null.
- **Impact:** Generic Gemini error.
- **Suggested Fix:** Surface warn.

## [BUG-UI-6] Dead animateTo + leaked timeout
- **File:** src/app/projects/[id]/processing/ProcessingClient.tsx, line 124-140, 322-326
- **Severity:** Medium
- **Category:** Performance / Dead Code
- **Description:** animateTo dead with eslint-disable, shipped. hasStarted setTimeout 320ms not cleared on unmount.
- **Impact:** Bundle bloat, leak.
- **Suggested Fix:** Delete animateTo, clear timeout.

## [BUG-UI-7] Unsafe cast videoBlob as File
- **File:** src/app/projects/[id]/processing/ProcessingClient.tsx, line 153
- **Severity:** High
- **Category:** Type / Logic
- **Description:** proj.videoBlob as unknown as File hides Blob mismatch; extractAudio reads file.name undefined.
- **Impact:** Extract fails for old projects.
- **Suggested Fix:** extractAudio(blob: Blob).

## [BUG-UI-8] Stale id race in runPipeline
- **File:** src/app/projects/[id]/processing/ProcessingClient.tsx, line 97-273
- **Severity:** Medium
- **Category:** Data / Performance
- **Description:** runPipeline captures id; nav a->b without unmount, first put can overwrite second.
- **Impact:** Cross-project corruption.
- **Suggested Fix:** cancelled on id change.

## [BUG-UI-9] Auto-save fire-and-forget beforeunload
- **File:** src/context/EditorContext.tsx, line 687-736
- **Severity:** High
- **Category:** Data / Logic
- **Description:** 800ms debounced update catches console.error only no UI; beforeunload void update may be killed.
- **Impact:** Data loss with Saved showing.
- **Suggested Fix:** Toast error, visibilitychange.

## [BUG-UI-10] Slider history bloat per pixel
- **File:** src/components/editor/StylePanel.tsx, line 344-350
- **Severity:** Medium
- **Category:** Performance / UI
- **Description:** handleSliderCommit no-op; updateStyle pushes history if sinceLastPush>40ms -> ~15 pushes/sec filling 50 depth.
- **Impact:** Undo unusable.
- **Suggested Fix:** Push once onPointerDown.

## [BUG-UI-11] Timestamp invalid silently ignored
- **File:** src/components/editor/CaptionRow.tsx, line 240-258
- **Severity:** Medium
- **Category:** UI / Accessibility
- **Description:** if s===null return no feedback, no aria-invalid.
- **Impact:** Stuck editing.
- **Suggested Fix:** Inline error.

## [BUG-UI-12] onWordUpdate signature mismatch
- **File:** src/components/editor/CaptionRow.tsx, line 18-22
- **Severity:** Medium
- **Category:** Type / Logic
- **Description:** Props typed (id,idx,new,orig) but handler ignores 4th.
- **Impact:** Dead param.
- **Suggested Fix:** Align signatures.

## [BUG-UI-13] Rename double-save wedge
- **File:** src/components/dashboard/ProjectCard.tsx, line 176-189
- **Severity:** Medium
- **Category:** Logic / UI
- **Description:** onBlur+Enter can fire twice; if onRename throws setIsRenaming false never runs.
- **Impact:** Wedged input.
- **Suggested Fix:** try/finally + dedup.

## [BUG-UI-14] Search badge not aria-live
- **File:** src/components/editor/CaptionList.tsx, line 269-280
- **Severity:** Low
- **Category:** Accessibility
- **Description:** Matching count updates not aria-live, placeholder hardcoded.
- **Impact:** WCAG 4.1.3.
- **Suggested Fix:** aria-live polite.

## [BUG-UI-15] Hardcoded strings bypass i18n
- **File:** src/app/page.tsx:57, src/components/editor/VideoPlayer.tsx:533, src/lib/utils.ts:70 + many
- **Severity:** Medium
- **Category:** i18n
- **Description:** 120+ literals English; relativeTime hardcoded m ago, no Intl.
- **Impact:** Locale switch still English.
- **Suggested Fix:** next-intl + Intl.RelativeTimeFormat.

## [BUG-UI-16] formatDuration ignores locale
- **File:** src/lib/utils.ts, line 32-41, 63-79
- **Severity:** Low
- **Category:** i18n / Data
- **Description:** Math.floor M:SS not Intl.DurationFormat; future diff returns Just now.
- **Impact:** Wrong for non-en.
- **Suggested Fix:** Guard future, use Intl.

## [BUG-UI-17] Volume slider hidden on mobile
- **File:** src/components/editor/VideoPlayer.tsx, line 571-601
- **Severity:** Medium
- **Category:** Accessibility / UI
- **Description:** hidden sm:flex makes slider display:none <640 but handler stays.
- **Impact:** Unreachable volume.
- **Suggested Fix:** sr-only or popover.

## [BUG-UI-18] Triple getVideoMetadata decode
- **File:** src/components/editor/EditorShell.tsx, line 90 + VideoPlayer.tsx, line 209
- **Severity:** Medium
- **Category:** Performance
- **Description:** Both call getVideoMetadata + Waveform decodes audio -> triple decode 60MB.
- **Impact:** 1-2s TTI jank.
- **Suggested Fix:** Cache Map.

## [BUG-UI-19] CanvasOverlay rAF teardown storm
- **File:** src/components/editor/CanvasOverlay.tsx, line 129-207
- **Severity:** Medium
- **Category:** Performance
- **Description:** Effect dep [segments] new ref every edit cancels rAF each keystroke.
- **Impact:** Lag.
- **Suggested Fix:** Use ref.

## [BUG-UI-20] CanvasOverlay no AT alternative
- **File:** src/components/editor/CanvasOverlay.tsx, line 213-229
- **Severity:** High
- **Category:** Accessibility
- **Description:** div aria-hidden canvas only, no text alternative.
- **Impact:** WCAG 1.1.1.
- **Suggested Fix:** Off-screen aria-live mirroring active text.

## [BUG-UI-21] ExportModal dead handleClose + scroll lock leak
- **File:** src/components/modals/ExportModal.tsx, line 242-250, 131-139
- **Severity:** Low
- **Category:** Dead Code / UI
- **Description:** handleClose dead; body overflow lock not counter based with multiple modals.
- **Impact:** Scroll bleed.
- **Suggested Fix:** Counter lock.

## [BUG-UI-22] Export filename hydration mismatch
- **File:** src/components/modals/ExportModal.tsx, line 176-192
- **Severity:** Medium
- **Category:** UI / Type
- **Description:** MediaRecorder.isTypeSupported client-only -> SSR fallback MP4 vs client webm.
- **Impact:** Hydration Text mismatch.
- **Suggested Fix:** init null useEffect.

## [BUG-UI-23] QuickSettings pending not cleared on cancel
- **File:** src/components/modals/QuickSettingsModal.tsx, line 195-208
- **Severity:** Medium
- **Category:** Logic / Data
- **Description:** close just setIsOpen false, pending remains, auto-opens ghost.
- **Impact:** Ghost modal.
- **Suggested Fix:** clearPendingFile on cancel.

## [BUG-UI-24] Settings drag handle visual only
- **File:** src/components/modals/SettingsWindow.tsx, line 92-103, 632-634
- **Severity:** Medium
- **Category:** UI / Dead Code
- **Description:** Drag to reorder handle but no draggable logic.
- **Impact:** Misleading.
- **Suggested Fix:** Implement dnd-kit or remove.

## [BUG-UI-25] globals.css dead vars + print
- **File:** src/app/globals.css, line 13-18, 279-372
- **Severity:** Low
- **Category:** UI / Dead Code
- **Description:** --canvas-deep, --gradient-rose unused; .btn-ghost 0 imports; no print media.
- **Impact:** Bloat, print blocks.
- **Suggested Fix:** Prune, add @media print.

## [BUG-UI-26] Empty nav landmark
- **File:** src/components/layout/SiteHeader.tsx, line 116-118
- **Severity:** Low
- **Category:** Accessibility
- **Description:** nav aria-label Primary navigation with no links, hidden md:flex empty.
- **Impact:** Landmark confusion.
- **Suggested Fix:** Remove.

## [BUG-UI-27] Toast timer resets on onClose identity
- **File:** src/components/ui/Toast.tsx, line 23-30
- **Severity:** Medium
- **Category:** Logic / Performance
- **Description:** Dep [onClose] inline causes timer reset each parent render; inner timeout not cleared.
- **Impact:** Sticks forever.
- **Suggested Fix:** useCallback + ref.

## [BUG-UI-28] Waveform nested slider invalid
- **File:** src/components/editor/Waveform.tsx, line 342-467
- **Severity:** Medium
- **Category:** Accessibility
- **Description:** timeline role slider nests buttons role button + handle slider violates tree.
- **Impact:** AT confused.
- **Suggested Fix:** role group.

## [BUG-UI-29] Truncate vs maxLength inconsistent
- **File:** src/components/dashboard/ProjectCard.tsx, line 26,188
- **Severity:** Low
- **Category:** UI / Data
- **Description:** maxLength 60 vs truncate 28.
- **Impact:** Collision.
- **Suggested Fix:** Sync.

## [BUG-UI-30] Dead hook useUndoRedo
- **File:** src/hooks/useUndoRedo.ts
- **Severity:** Low
- **Category:** Dead Code / Performance
- **Description:** 0 importers, duplicates EditorContext.
- **Impact:** Bloat.
- **Suggested Fix:** Delete.

## [BUG-UI-31] Focus-visible clipped
- **File:** src/app/globals.css, line 244-249
- **Severity:** Low
- **Category:** UI / Accessibility
- **Description:** outline offset 2px inside overflow-hidden cards clipped.
- **Impact:** Invisible focus.
- **Suggested Fix:** box-shadow.

## [BUG-UI-32] [VERIFY] Waveform stale closure mid-drag
- **File:** src/components/editor/Waveform.tsx, line 233-318
- **Severity:** Medium
- **Category:** Data
- **Description:** handleEdgePointerDown captures segments closure stale vs displaySegments in window listener.
- **Impact:** Overlap. Verify by editing then dragging.
- **Suggested Fix:** Use ref.

---
Cross-cutting: no i18n framework, no dir rtl swap, live regions missing, over-fetch, focus traps incomplete.
Read-only: tsc 0, lint no src hard errors.
