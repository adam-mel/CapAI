> © 2026 CapAI — All Rights Reserved. Viewing only. See [LICENSE](./LICENSE).

# CapAI — AI Captions, Burned In.

[![License: All Rights Reserved](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](#license)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js%2016-black)](#tech-stack)
[![FFmpeg.wasm](https://img.shields.io/badge/Video-FFmpeg.wasm-0A0A0F)](#tech-stack)
[![Gemini 2.5 Flash](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-4285F4)](#tech-stack)

**Upload a video → get word-level timestamped captions in seconds → style them with full creative control → burn them in and download — entirely in your browser, for free.**

CapAI is a free, personal, single-user browser app (no backend, no auth, no upload). Audio is extracted client-side and sent only to Google Gemini 2.5 Flash for transcription; video never leaves your browser. Captions are rendered live on a `<canvas>` overlay and burned into the export via canvas `captureStream` + `MediaRecorder` (primary) or FFmpeg.wasm fallback — all WASM/client-side.

---

## Features

- **AI transcription** — Gemini 2.5 Flash returns word-level `WordToken[]` with `startMs`/`endMs`/`confidence`; grouped into `CaptionSegment[]` by words-per-segment.
- **Dynamic vs Static** — Dynamic: word-by-word highlight (Karaoke / Pill / Pop & Scale). Static: full-segment burn. Toggle is instant.
- **Live canvas preview** — Captions drawn on every `timeupdate`; no FFmpeg needed for preview.
- **Style Panel** — Font family/size/weight/style/case, colors (text/stroke/shadow), background pill (color/opacity/padding/radius), highlight colors, position preset (top/center/bottom) + offset, alignment. All changes live-preview.
- **Presets** — Reels (Montserrat 52px Black), Clean (Inter + pill), Bold Drop (Impact 60px gold), Custom.
- **Caption editing** — Inline `contenteditable` per word, timestamp inputs, confidence warnings (`⚠` <0.75), search, Split/Merge/Delete/Copy, undo/redo (50), Revert to AI Original.
- **Waveform strip** — Collapsible ~80px strip, segment blocks, draggable playhead + edge handles.
- **IndexedDB (Dexie)** — Projects table (`projects`), auto-save debounced 800ms, thumbnail from first frame.
- **Export** — Primary: hidden `<video>` + offscreen canvas at native resolution → `captureStream(30)` → `MediaRecorder` (vp9/vp8/webm, 5–8 Mbps) + audio via `video.captureStream()`. Fallback: FFmpeg.wasm. Filename `{original}_captioned.{mp4|webm}`.

## Design

UI follows **ElevenLabs editorial** spec (`DESIGN-elevenlabs.md`): off-white canvas `#f5f5f5`, warm near-black ink `#0c0a09`/`#292524`, 5 pastel gradient orbs (mint/peach/lavender/sky/rose) as atmosphere only, **Waldenburg Light 300** display (fallback EB Garamond) + **Inter** body, pill CTAs `rounded: 9999px`, hairline borders, 96px section rhythm. Player/caption-list/style-panel responsive: 3-col desktop, 2-col tablet, bottom-sheet mobile.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| AI / Transcription | Google Gemini 2.5 Flash API |
| Video Processing | FFmpeg.wasm (fallback), Canvas `captureStream` + `MediaRecorder` (primary) |
| State Persistence | IndexedDB via Dexie.js, `localStorage` for Gemini key + last project |
| Fonts | `next/font` — EB Garamond + Inter |
| Testing | Vitest + Testing Library, Playwright |

## Getting Started

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # next build --webpack
npm start      # next start
npm test       # vitest run
```

### Gemini API Key

CapAI is client-side: your key is stored in `localStorage` under `capai_gemini_api_key` (and obfuscated `capai_gemini_api_keys` for multi-key). Paste it when prompted on the Processing screen, or via Settings. No key is committed — `.env*` is gitignored. If you use `.env.local` locally, never commit it:

```ini
# .env.local (gitignored)
GEMINI_API_KEY=your_key_here
```

The key is sent via `?key=` query param to `generativelanguage.googleapis.com` with `Referrer-Policy: no-referrer` + CSP `connect-src` (see `next.config.ts`). For billed/high-value keys, prefer a server-side proxy (future).

Supported key formats: `AIza...` (39 chars) and new `AQ....` (AQ. + 20–200 base64url). Validation is permissive; live `testGeminiKey` is the real check.

## Project Structure

```
src/
  app/              # Next.js App Router (layout.tsx, page.tsx, projects/[id]/)
  components/       # dashboard, editor (CanvasOverlay, CaptionList, VideoPlayer, Waveform, StylePanel), modals, layout
  lib/              # gemini.ts, geminiKeys.ts, db.ts, canvasExport.ts, canvasRenderer.ts, ffmpeg.ts, presets.ts
  hooks/            # useProjects, useCaptionOperations, useUndoRedo, useVideoPlayer
  store/            # pendingUpload
CapAI_PRD_v1.md     # Full PRD + UI/UX spec (locked v1.0)
DESIGN-elevenlabs.md # Design tokens + component specs
```

See `CapAI_PRD_v1.md` §5 for `Project`/`CaptionSegment`/`WordToken`/`CaptionStyle` types, and §11 for the Gemini prompt template.

## Deployment — Vercel

Vercel deploys from either **public** or **private** GitHub repos (private requires granting Vercel access). No server config needed — fully static/client-side.

1. Push to GitHub (`main` branch).
2. Import project in [Vercel](https://vercel.com/new) → select `capai` repo → Framework preset **Next.js** → Deploy.
3. No env vars required for core app (Gemini key is per-user in browser). If you add a server proxy later, add its key in Vercel → Settings → Environment Variables.

Build command: `npm run build` (`next build --webpack`). Output: `.next` (gitignored) + `.vercel` (gitignored).

## License

**© 2026 CapAI — All Rights Reserved. Viewing only.**

This repository is published for **viewing/portfolio purposes only**. You may view the code on GitHub. You may **NOT** copy, clone, fork, modify, distribute, sublicense, sell, or claim this work as your own without explicit written permission. See [LICENSE](./LICENSE) for the full proprietary terms. GitHub's Download ZIP / clone button cannot be disabled on public repos — the license is the legal protection; unauthorized reuse is subject to DMCA takedown.

Alternatives if you later want to allow limited reuse: `CC BY-NC-ND 4.0` (non-commercial, no derivatives), `PolyForm Noncommercial 1.0.0`, or `BUSL-1.1` (source-available with delayed open-source). Default here is **All Rights Reserved** as the strongest protection for "no one can download and make it his."

---

> © 2026 CapAI — All Rights Reserved. Viewing only.
