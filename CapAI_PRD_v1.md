# CapAI — Product Requirements & UI/UX Specification
## Version 1.0 · Single-User Web App

---

## 1. Product Overview

**CapAI** is a free, personal, single-user browser-based application for generating
and burning styled video captions. It uses Google Gemini 2.5 Flash for AI-powered
audio transcription and FFmpeg.wasm for fully client-side video processing — no
video data ever leaves the user's browser, no server required.

### Core Value Proposition
Upload a video → get word-level timestamped captions in seconds → style them with
full creative control → burn them in and download — entirely in the browser, for free.

### Tech Stack

| Layer               | Technology                              |
|---------------------|-----------------------------------------|
| Framework           | Next.js (App Router)                    |
| Styling             | Tailwind CSS                            |
| AI / Transcription  | Google Gemini 2.5 Flash API             |
| Video Processing    | FFmpeg.wasm (client-side, WASM)         |
| State Persistence   | IndexedDB (via Dexie.js)                |
| Auth / Backend      | None — fully client-side                |

---

## 2. End-to-End User Workflow

```
Home Dashboard (Project Grid)
    │
    ▼  Click "New Project" or drag-and-drop a video file
Upload (drag-and-drop / file picker)
    │
    ▼  File accepted
Quick Settings Modal
    (caption mode · language · font preset · words per segment)
    │
    ▼  Click "Generate Captions →"
AI Processing Screen
    (Audio Extract → Transcribe → Parse → Ready)
    │
    ▼  Captions ready
Main Editor  ←──────────────────────────────────────┐
    (3 columns: Video Player | Caption List | Style Panel)  │
    │                                                │
    ▼  Click "Export →"                       Auto-saved to IndexedDB
Export (spinner → Download MP4)
    │
    ▼
Back to Dashboard
```

---

## 3. Design System

### 3.1 Visual Language

| Property    | Decision                                                         |
|-------------|------------------------------------------------------------------|
| Theme       | Dark mode only — no toggle                                       |
| Personality | Modern SaaS dark (Linear / Vercel aesthetic)                     |
| Feel        | Professional editor tool — CapCut meets Linear                   |
| Motion      | Subtle — 150–200ms easing, no bounce, no over-animation          |

### 3.2 Color Palette (CSS Token Reference)

| Token                | Value                    | Usage                            |
|----------------------|--------------------------|----------------------------------|
| `--bg-base`          | `#0A0A0F`                | App background                   |
| `--bg-surface`       | `#111118`                | Cards, panels                    |
| `--bg-elevated`      | `#1A1A24`                | Modals, dropdowns                |
| `--bg-hover`         | `#22222F`                | Hover states                     |
| `--border`           | `#2A2A3A`                | Panel dividers                   |
| `--border-subtle`    | `#1E1E2A`                | Subtle separators                |
| `--accent`           | `#6366F1`                | Indigo — primary CTA, active UI  |
| `--accent-hover`     | `#4F46E5`                | CTA hover                        |
| `--accent-glow`      | `rgba(99,102,241,0.15)`  | Focus rings, glow effects        |
| `--text-primary`     | `#F0F0F8`                | Primary text                     |
| `--text-secondary`   | `#8888A8`                | Secondary / muted labels         |
| `--text-muted`       | `#55556A`                | Timestamps, placeholders         |
| `--success`          | `#22C55E`                | Export done, step complete       |
| `--warning`          | `#F59E0B`                | Low-confidence caption words     |
| `--error`            | `#EF4444`                | API errors, destructive actions  |

### 3.3 Typography

| Role             | Font               | Notes                              |
|------------------|--------------------|------------------------------------|
| UI               | Geist / Inter      | Next.js default — clean, readable  |
| Caption preview  | User-selectable    | Loaded on demand via Google Fonts  |
| Timestamps       | Geist Mono         | Fixed-width for alignment          |

### 3.4 Spacing & Shape

- **Border radius:** `8px` cards · `6px` inputs · `4px` badges · `12px` modals
- **Panel separators:** `1px` solid `--border` lines (not gaps)
- **Base unit:** `4px` spacing scale
- **Tap targets (mobile):** Minimum `44×44px`

---

## 4. Screen Specifications

---

### 4.1 Home — Project Dashboard

**Purpose:** Entry point. Shows all saved projects and the path to start a new one.

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│  ✦ CapAI          AI Captions, Burned In.   [+ New Project]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ [thumb]  │  │ [thumb]  │  │ [thumb]  │              │
│  │          │  │          │  │          │              │
│  │ video.mp4│  │ reel.mov │  │ talk.mp4 │              │
│  │ 2h ago   │  │ Yesterday│  │ 3d ago   │              │
│  │ Dynamic·EN│  │ Static·FR│  │ Dynamic·AR│             │
│  │[Open][⋮] │  │[Open][⋮] │  │[Open][⋮] │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Project card anatomy:**
- Auto-generated thumbnail from the video's first frame
- Video filename (truncated at 24 chars with ellipsis)
- Relative timestamp ("2h ago", "Yesterday", "3 days ago")
- Mode + language badge (e.g. `Dynamic · EN`)
- `[Open]` primary button + `[⋮]` overflow menu → Rename / Delete

**Grid responsiveness:**
- Desktop (`>1024px`): 3 columns
- Tablet (`640–1024px`): 2 columns
- Mobile (`<640px`): 1 column

**Empty state (no projects yet):**
```
        ✦

   No projects yet.
   Drop a video anywhere to begin.

        [+ New Project]
```
- Entire page is a passive drag-and-drop target
- On drag-over: subtle indigo pulsing border glow around the viewport edge

---

### 4.2 Upload

**Accepted formats:** MP4, MOV, WebM, MKV, AVI
**Size limit:** Soft warning at 2 GB (FFmpeg.wasm memory constraint)

**Entry paths:**
1. Click `[+ New Project]` → native OS file picker
2. Drag and drop anywhere on the Dashboard

After a valid file is received → immediately open Quick Settings Modal.

**Invalid file toast:** `"Unsupported format. Please upload MP4, MOV, WebM, MKV, or AVI."`

---

### 4.3 Quick Settings Modal

**Purpose:** Configure the project before AI generation starts.
**Trigger:** Fires immediately after a video file is accepted.

```
┌──────────────────────────────────────────────┐
│  🎬 New Project                           ✕  │
│  video-name.mp4  ·  2m 34s  ·  124 MB        │
│  ──────────────────────────────────────────  │
│                                              │
│  Caption Mode                                │
│  [● Dynamic]  [  Static  ]  ← toggle pills   │
│                                              │
│  Transcription Language                      │
│  [🌐 English (en)                        ▾]  │
│                                              │
│  Starting Style Preset                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐  │
│  │ Reels  │ │ Clean  │ │  Bold  │ │Custom│  │
│  │ [Aa]   │ │  [Aa]  │ │  [Aa] │ │  +   │  │
│  └────────┘ └────────┘ └────────┘ └──────┘  │
│  Visual mini-previews showing font + colors  │
│                                              │
│  Words per Caption Segment                   │
│  [2]  [3]  [● 4]  [5]  ← pill selectors     │
│                                              │
│  ──────────────────────────────────────────  │
│  [Cancel]              [✦ Generate Captions →]│
└──────────────────────────────────────────────┘
```

**Field details:**

| Field | Options | Default |
|---|---|---|
| Caption Mode | Dynamic / Static | Dynamic |
| Language | Dropdown: EN, FR, ES, DE, PT, AR, HE, ZH, JA, KO, IT, RU | English |
| Style Preset | Reels, Clean, Bold Drop, Custom | Reels |
| Words per Segment | 2, 3, 4, 5 | 3 |

**Notes:**
- All settings are saved to the project's IndexedDB record
- RTL languages (AR, HE) flag the project for right-to-left text rendering
- `[✦ Generate Captions →]` triggers the processing pipeline

---

### 4.4 AI Processing Screen

**Purpose:** Full-screen dedicated status view while audio extraction and
transcription run. Replaces anxiety with transparency.

```
┌──────────────────────────────────────────────┐
│                                              │
│         ✦ CapAI                              │
│                                              │
│    ┌────────────────────────────────────┐    │
│    │   [Video thumbnail — blurred]      │    │
│    └────────────────────────────────────┘    │
│                                              │
│         Generating Captions...               │
│                                              │
│    ✓  Extracting audio track           Done  │
│    ⟳  Sending audio to Gemini     In progress│
│    ○  Parsing word timestamps            —   │
│    ○  Building caption segments          —   │
│                                              │
│    [████████████████░░░░░░░░░░░░░░░] 52%     │
│                                              │
│    "Usually takes 20–90s for long videos."   │
│                                              │
│                   [Cancel]                   │
│                                              │
└──────────────────────────────────────────────┘
```

**Step state indicators:**
- `○` Pending (muted)
- `⟳` Active (animated spin, indigo)
- `✓` Done (green)

**Error state (API key / network failure):**
```
┌──────────────────────────────────────────────┐
│                                              │
│    ✕  Gemini API Error                       │
│                                              │
│    Could not reach the Gemini API.           │
│    Check your API key and try again.         │
│                                              │
│    Your Gemini API Key                       │
│    [AIzaSy...________________________] [Paste]│
│                                              │
│    [← Back]              [Retry →]           │
│                                              │
└──────────────────────────────────────────────┘
```

**API key persistence:**
- Saved to `localStorage` under `capai_gemini_api_key`
- Separate from project data — persists across all projects
- On successful call: silently confirmed, no need to re-enter

---

### 4.5 Main Editor

The core screen. Three-column layout on desktop.

**Top header bar:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ ✦ CapAI  │  video-name.mp4  │  [Dynamic ↔ Static]  │  Saved ✓  │  [⟳ Revert]  [Export →] │
└──────────────────────────────────────────────────────────────────────┘
```

- `[Dynamic ↔ Static]` — mode toggle pill, switches rendering immediately
- `Saved ✓` — auto-save status indicator, fades after 2s
- `[⟳ Revert]` — revert to original AI output (with confirmation)
- `[Export →]` — opens export confirmation modal

**Full editor layout (desktop):**

```
┌───────────────────────────┬─────────────────┬───────────────────┐
│                           │                 │                   │
│     VIDEO PLAYER          │  CAPTION LIST   │   STYLE PANEL     │
│       (~50% width)        │   (~30% width)  │    (~20% width)   │
│                           │                 │   [‹ collapse]    │
│                           │                 │                   │
├───────────────────────────┴─────────────────┴───────────────────┤
│  [∧ WAVEFORM STRIP — collapsible]                               │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 4.5.1 Video Player Panel (Left ~50%)

**Renders:**
- The raw `<video>` element
- A `<canvas>` element positioned absolutely on top, matching video dimensions
- Captions drawn to canvas on every `timeupdate` event — no FFmpeg in preview
- Active caption: thin `rgba(255,255,255,0.08)` rounded box behind caption text

**Player chrome (bottom control bar):**
```
[▶]  [────────────●───────────────────────]  0:42 / 2:34
[0.5×] [1×] [1.5×] [2×]      [🔊───────]   [⛶ Fullscreen]
```

| Control | Detail |
|---|---|
| Play/Pause | Button + `Space` key |
| Seek bar | Click or drag; shows hover timestamp |
| Speed | Pill selector: 0.5× · 1× · 1.5× · 2× |
| Volume | Slider; click icon to toggle mute |
| Frame step | `←` / `→` keys (~33ms per step) when not editing |
| Fullscreen | Expands player only; captions continue rendering |

**Active caption overlay:**
- A subtle translucent rounded rect `rgba(255,255,255,0.07)` appears behind the
  active caption text block
- 200ms fade-in, 200ms fade-out
- Clicking the overlay area does NOT trigger edit — editing is caption-list-only

**Behavior when caption row is clicked:**
- Video auto-seeks to that segment's `startMs`
- Playback immediately starts from that point
- The corresponding caption segment gets the active indigo left-border highlight

---

#### 4.5.2 Caption List Panel (Center ~30%)

**Panel header:**
```
┌────────────────────────────────────────────┐
│  🔍 Search captions...          [+ Add Seg] │
└────────────────────────────────────────────┘
```

**Caption segment row (collapsed):**
```
┌────────────────────────────────────────────┐
│ ● 00:00.000 → 00:02.140         [⚠] [···] │  ← active row (indigo left border)
│ Hello and welcome to my channel            │
└────────────────────────────────────────────┘
```

**Caption segment row (hovered — action row revealed):**
```
┌────────────────────────────────────────────┐
│ ○ 00:02.150 → 00:04.880                [···]│
│ Today we're going to talk about            │
│ [Split]  [Merge ↓]  [✕ Delete]            │
└────────────────────────────────────────────┘
```

**Row anatomy:**

| Element | Detail |
|---|---|
| Left border | Indigo `3px` = active segment; transparent = inactive |
| Timestamp | `MM:SS.mmm → MM:SS.mmm` — click to expand numeric inputs |
| `⚠` badge | Shown when any word in segment has `confidence < 0.75` |
| `[···]` | Overflow menu: Split / Merge / Delete / Copy text |
| Text body | Inline-editable (see below) |
| `[Split]` | Splits at playhead position |
| `[Merge ↓]` | Merges with segment directly below |
| `[✕ Delete]` | Deletes segment, undoable |

**Inline text editing:**
- Click any word in the transcript → that `<span>` becomes `contenteditable`
- Cursor appears exactly at the clicked word
- `Enter` → confirms edit, focus moves to next segment's first word
- `Escape` → cancels, restores original text
- No modal, no popover, no save button — purely inline

**Confidence highlighting:**
- Words with `confidence < 0.75`: amber underline + dotted border
- Hover tooltip: *"Low confidence — click to correct"*
- `⚠` badge on the row header signals at least one uncertain word

**Timestamp inline editing (expanded):**
```
│  [00:02.150]  →  [00:04.880]   ✓  │
```
- Click timestamp row → inputs appear pre-filled and selected
- `Tab` moves between start and end fields
- `Enter` confirms; `Escape` cancels
- Also editable via waveform drag handles (synced bidirectionally)

**Search:**
- Real-time filter as user types
- Matching words highlighted in amber within the list
- Non-matching rows dimmed (not hidden) for context
- Video playhead does NOT move during search

---

#### 4.5.3 Style Panel (Right ~20% — Collapsible)

**Collapse toggle:** `‹` chevron on the panel's left edge collapses to a `40px`
icon rail showing section icons only. `›` expands it.

**Panel header:**
```
┌──────────────────────────────────┐
│  Style                     [‹]  │
│  [Reels] [Clean] [Bold] [Custom] │  ← preset pills
└──────────────────────────────────┘
```

Clicking a preset loads all style values at once. Any manual tweak sets the
indicator to `Custom`.

**Sections (collapsible accordions):**

```
▼ FONT
  Family   [Inter                   ▾]   (Google Fonts on demand)
  Size     [●────────────────]  48px
  Weight   [Normal]  [Bold]  [Black]
  Style    [Regular]  [Italic]
  Case     [None]  [UPPER]  [lower]  [Title]

▼ COLORS
  Text      [████]  #FFFFFF
  Stroke    [████]  #000000    Width  [──●──]  2px
  Shadow    [████]  #000000    Blur   [──●──]  4px
             Offset X [─●──] 2   Y [─●──] 2

▼ BACKGROUND PILL
  Enabled   [●──────]  ON
  Color     [████]  #000000    Opacity  [─────●]  75%
  Padding   [──●──────────]  8px
  Radius    [──●──────────]  8px

▼ HIGHLIGHT  (Dynamic mode only — grayed out in Static mode)
  Style     [Karaoke]  [Pill]  [Pop & Scale]
  Active word color    [████]  #FFD700
  Inactive word color  [████]  #FFFFFFAA

▼ POSITION
  Preset    [Top]  [Center]  [● Bottom]
  V-Offset  [──────────●──]  +12px   (–50 to +50)
  H-Align   [Left]  [● Center]  [Right]

▼ ALIGNMENT
  Text      [Left]  [● Center]  [Right]
```

**Live preview:** Every control change instantly redraws the caption canvas overlay.
No "Apply" button needed.

---

#### 4.5.4 Waveform Strip (Bottom — Collapsible)

**Toggle:** `∧` / `∨` chevron on the right end of the strip. Default: **collapsed**.

**When expanded (height: ~80px):**
```
┌──────────────────────────────────────────────────────────────┐
│   ║                                                          │  ← playhead
│ ▁▂▄█▆▃▂▁▄▆▅▂ ▁▂▅▄▃ ▁▃▆█▅▂▃▄ ▁▂▃▅▄▂▁▃▆▅▃▁ ▂▄▅▃▂▁           │
│ [═══════]  [══════]   [═══════════]   [═══════════]         │
└──────────────────────────────────────────────────────────────┘
```

- Waveform rendered from the extracted audio buffer
- Caption segments shown as colored blocks on the timeline
  - Active segment: `--accent` indigo fill
  - Other segments: `rgba(99,102,241,0.3)`
  - Gaps between segments: empty (transparent)
- Playhead: white `1px` vertical line, draggable left/right
- **Drag segment edge handles** → adjusts `startMs` / `endMs`, synced live to
  the caption list timestamp inputs and the video preview

---

### 4.6 Revert to AI Original

**Trigger:** `[⟳ Revert]` button in the top header.

**Confirmation dialog:**
```
┌──────────────────────────────────────────────┐
│  Revert to AI Original?                      │
│                                              │
│  This will reset all captions to the first  │
│  Gemini output. Your edits will be lost and  │
│  cannot be undone.                           │
│                                              │
│  [Cancel]              [Revert Captions]     │
│                       (red destructive btn)  │
└──────────────────────────────────────────────┘
```
- On confirm: `segments` array is replaced with `originalSegments` (deep copy)
- Undo/Redo stack is cleared
- Style settings are NOT reset — only caption text/timing

---

### 4.7 Export

**Trigger:** `[Export →]` button in top header.

**Step 1 — Pre-export confirmation modal:**
```
┌──────────────────────────────────────────────┐
│  Export Video                                │
│                                              │
│  Format     MP4 (H.264)                      │
│  Quality    Original resolution (no re-encode)│
│  Captions   Burned-in (hard subtitles)       │
│  Duration   2m 34s                           │
│  Mode       Dynamic · Karaoke highlight      │
│                                              │
│  [Cancel]              [Start Export →]      │
└──────────────────────────────────────────────┘
```

**Step 2 — Export in progress (full-screen overlay):**
```
┌──────────────────────────────────────────────┐
│                                              │
│              ✦ CapAI                         │
│                                              │
│           Exporting...                       │
│              ⟳  (indigo spinner)             │
│                                              │
│    Large videos may take a few minutes.      │
│                                              │
│              [Cancel]                        │
│                                              │
└──────────────────────────────────────────────┘
```

**Step 3 — Export complete:**
```
│           ✓  Done!                           │
│                                              │
│   [↓ Download video-name_captioned.mp4]      │
│                                              │
│   [Export Again]        [Back to Editor]     │
```

**Filename convention:** `{original_name}_captioned.mp4`

**FFmpeg.wasm pipeline:**
1. Load video file from IndexedDB Blob
2. Write to FFmpeg virtual filesystem
3. Render each caption frame using offscreen canvas → write as subtitle filter
   input, OR use `drawtext` filter with libass
4. Run encode at original resolution, copy audio stream
5. Output MP4 to virtual FS → read as `Uint8Array` → create `Blob` → `URL.createObjectURL`
6. Trigger browser download

---

## 5. Caption System

### 5.1 Data Model (TypeScript)

```typescript
interface Project {
  id: string;                      // uuid v4
  name: string;                    // from filename, user-renameable
  createdAt: number;               // Unix ms timestamp
  updatedAt: number;               // Unix ms timestamp
  videoBlob: Blob;                 // stored in IndexedDB
  thumbnailDataUrl: string;        // first-frame JPEG data URI
  settings: ProjectSettings;
  captionStyle: CaptionStyle;
  segments: CaptionSegment[];      // user's working copy
  originalSegments: CaptionSegment[]; // Gemini output — never mutated
}

interface ProjectSettings {
  mode: 'dynamic' | 'static';
  language: string;                // BCP-47: "en", "fr", "ar", etc.
  wordsPerSegment: 2 | 3 | 4 | 5;
  rtl: boolean;                    // derived from language
}

interface CaptionSegment {
  id: string;                      // uuid
  startMs: number;
  endMs: number;
  text: string;                    // full text of segment
  words: WordToken[];              // word-level timing (for Dynamic mode)
  confidence?: number;             // min confidence across words (0–1)
}

interface WordToken {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;             // per-word confidence from Gemini
}

interface CaptionStyle {
  preset: 'Reels' | 'Clean' | 'Bold Drop' | 'Custom';
  // Font
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 700 | 900;
  fontStyle: 'normal' | 'italic';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign: 'left' | 'center' | 'right';
  // Colors
  color: string;                   // hex
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  // Background pill
  pillEnabled: boolean;
  pillColor: string;
  pillOpacity: number;             // 0–1
  pillPaddingX: number;
  pillPaddingY: number;
  pillRadius: number;
  // Dynamic mode highlight
  highlightStyle: 'karaoke' | 'pill' | 'pop';
  activeWordColor: string;
  inactiveWordColor: string;
  // Position
  positionPreset: 'top' | 'center' | 'bottom';
  positionOffsetY: number;         // px, –50 to +50
  hAlign: 'left' | 'center' | 'right';
}
```

---

### 5.2 Dynamic Mode — Word Highlight Rendering

Canvas redraws on every `timeupdate` event (~4× per second minimum).
Active word is determined by: `word.startMs <= currentTimeMs <= word.endMs`.

| Variant | Rendering mechanic |
|---|---|
| **Karaoke** | Active word: `activeWordColor` + `fontWeight 900`. Inactive words: `inactiveWordColor` at reduced opacity. Drawn word-by-word with `fillText`. |
| **Background Pill** | Active word gets a filled `roundRect` behind it before text draw. Color: `pillColor` at `pillOpacity`. All words same text color. |
| **Pop & Scale** | Active word drawn at `fontSize × 1.15` and `fontWeight 900`. Inactive at base size. Requires recalculating word x-positions each frame. |

Gemini 2.5 Flash returns word-level timestamps in the response JSON — these
are stored in `WordToken.startMs` and `WordToken.endMs`.

---

### 5.3 Static Mode — Segment Rendering

- Full `segment.text` rendered as one text block
- Displayed for the full `[startMs, endMs]` range
- All style properties apply: font, color, stroke, shadow, pill
- No word-by-word animation; `highlightStyle` controls are grayed out in Style Panel

---

### 5.4 Segment Operations

| Operation | Trigger | Behavior |
|---|---|---|
| **Split** | `[Split]` button or `S` key | Divides segment at current playhead `currentTimeMs`. Words before playhead → segment 1; words at/after → segment 2. Text recalculated from words. |
| **Merge** | `[Merge ↓]` button | Merges current segment with the one immediately below. Combined text (space-joined), `startMs` from first, `endMs` from second, words concatenated. |
| **Delete** | `[✕]` button or `Backspace/Delete` key | Removes segment from array. Added to undo stack. Gap in timeline is left empty (no captions play in that range). |
| **Add Blank** | `[+ Add Seg]` in list header | Inserts a new segment at playhead position with 2s default duration and empty text. User types to fill it. |

All operations are added to the undo stack immediately.

---

## 6. Undo / Redo System

| Property | Detail |
|---|---|
| Stack depth | 50 actions |
| Tracked actions | Text edits, splits, merges, deletes, adds, timestamp drags, all style changes |
| Undo shortcut | `Cmd/Ctrl + Z` |
| Redo shortcut | `Cmd/Ctrl + Shift + Z` |
| Implementation | Immutable snapshots of the `segments` array + `captionStyle` object pushed to a history array |

**Revert to AI Original** (separate from undo):
- Bypasses the undo stack entirely — it's a hard reset
- Replaces `segments` with a deep clone of `originalSegments`
- Clears the undo/redo stack after revert
- Style settings (`captionStyle`) are preserved

---

## 7. Keyboard Shortcuts Reference

| Shortcut | Action | Active context |
|---|---|---|
| `Space` | Play / Pause | Global (not while editing text) |
| `←` | Frame step back (~33ms) | Global (not while editing text) |
| `→` | Frame step forward (~33ms) | Global (not while editing text) |
| `Enter` | Confirm inline text edit → focus next segment | While editing text |
| `Escape` | Cancel inline text edit, restore original | While editing text |
| `S` | Split selected segment at playhead | Segment selected, not editing |
| `Backspace` / `Delete` | Delete selected segment | Segment selected, not editing |
| `Cmd/Ctrl + Z` | Undo | Global |
| `Cmd/Ctrl + Shift + Z` | Redo | Global |

---

## 8. State Management & Persistence

### 8.1 IndexedDB Schema (via Dexie.js)

```
Database: capai_db  (version 1)
  ├── Table: projects
  │     id · name · createdAt · updatedAt · videoBlob · thumbnailDataUrl
  │     · settings · captionStyle · segments · originalSegments
  └── (future: Table: exports for tracking export history)
```

### 8.2 Auto-Save Strategy

- **Debounced save:** 800ms after last state mutation
- **Save indicator in header:**
  `Saving...` (animated dots) → `Saved ✓` (green) → fades out after 2s
- **On page unload:** `beforeunload` triggers a final forced save attempt
- `videoBlob` is only written to IndexedDB once (on project creation) — not on
  every auto-save (performance optimization)

### 8.3 localStorage (Lightweight Preferences)

| Key | Value |
|---|---|
| `capai_gemini_api_key` | User's Gemini API key string |
| `capai_last_project_id` | UUID of last opened project |

---

## 9. Responsive Design

### 9.1 Breakpoints

| Breakpoint | Label | Layout |
|---|---|---|
| `< 640px` | Mobile | Single column. Player full-width top. Caption list below player. Style panel as bottom sheet (slides up from bottom on "Style" button tap). Waveform hidden entirely. |
| `640px – 1024px` | Tablet | Two columns: Player (left 60%) + Caption list (right 40%). Style panel as floating side drawer triggered by toolbar "Style" button. Waveform collapsible strip below. |
| `> 1024px` | Desktop | Full 3-column layout as primary design. |

### 9.2 Mobile-Specific Adaptations

- All tap targets: minimum `44 × 44px`
- Inline text editing triggers native mobile keyboard (no custom keyboard)
- Segment action row (`[Split]` `[Merge]` `[Delete]`) accessible via long-press
  context menu on mobile instead of hover reveal
- Speed control simplified to a single tap-cycle button: `1× → 1.5× → 2× → 0.5×`
- Fullscreen button enters native fullscreen (iOS/Android support via `requestFullscreen`)
- Style panel Bottom Sheet: slides up with a drag handle, covers lower 70% of screen
- Export button always visible in a sticky bottom bar on mobile

---

## 10. Style Panel Presets Reference

Three built-in presets + Custom:

| Preset | Font | Size | Weight | Color | Stroke | Pill | Highlight |
|--------|------|------|--------|-------|--------|------|-----------|
| **Reels** | Montserrat | 52px | Black (900) | #FFFFFF | #000 2px | OFF | Karaoke |
| **Clean** | Inter | 40px | Bold (700) | #FFFFFF | None | ON (black 70%) | Pill |
| **Bold Drop** | Impact | 60px | Black (900) | #FFD700 | #000 4px | OFF | Pop & Scale |
| **Custom** | Inter | 48px | Bold (700) | #FFFFFF | #000 2px | OFF | Karaoke |

---

## 11. Gemini API Integration Notes

### 11.1 Request Flow

1. FFmpeg.wasm extracts audio track from the uploaded video → `audio.mp3` or `audio.aac`
2. Audio file encoded as base64
3. POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
4. Prompt instructs Gemini to return a JSON array of word-level timestamped segments

### 11.2 Prompt Template

```
You are a professional video captioning assistant.
Transcribe the audio and return ONLY a JSON array. No markdown, no explanation.

Each object must have:
{
  "startMs": number,     // word start time in milliseconds
  "endMs": number,       // word end time in milliseconds
  "word": string,        // the spoken word
  "confidence": number   // 0.0 to 1.0
}

Language: {{language}}
```

### 11.3 Post-Processing (Client)

After receiving word tokens from Gemini:
1. Group words into segments of `settings.wordsPerSegment` words
2. Each segment: `startMs` = first word's startMs, `endMs` = last word's endMs
3. `text` = words joined with spaces
4. `confidence` = minimum word confidence in the segment (flags ⚠ badge)
5. Store both `segments` (working copy) and `originalSegments` (pristine)

---

## 12. Phase 2 Backlog

These features are explicitly out of scope for v1 but should be accounted for
in the data model and component architecture to avoid breaking changes.

| Feature | Rationale for deferral |
|---|---|
| Re-run AI on selected segment | Manual editing + confidence highlights cover v1 |
| J/K/L scrubbing (Premiere-style) | Power-user feature; keyboard shortcut table is clean without it |
| `Cmd+E` export shortcut | Low priority; Export button is always visible |
| A–B loop playback | Deferred; `I`/`O` key markers can be added to v2 without UI change |
| SRT / VTT export | Only MP4 burn in v1; file export formats are a common v2 request |
| Multiple caption tracks | Explicitly excluded by product decision |
| Translation via Gemini | Post-v1; requires a second API call pipeline |
| Segment drag-to-reorder | Nice-to-have; drag handles on waveform partially cover the need |
| Platform aspect ratio presets | Dropped from Quick Settings; can be a Style Panel preset in v2 |
| Re-run AI on a selected region | Partial transcription fix; Phase 2 confidence highlight flow is sufficient |
| Cloud sync / sharing | Not applicable — personal, local app |

---

*CapAI Product Requirements & UI/UX Specification — v1.0*
*Generated from 30-question PM/UX discovery session.*
*All 30 product decisions documented and locked.*
*Ready for component architecture and development sprint planning.*
