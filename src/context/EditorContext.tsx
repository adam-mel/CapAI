"use client";

import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionSegment, CaptionStyle, Project, ProjectSettings } from "@/lib/types";
import { db } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────────────

export type PlaybackRate = 0.5 | 1 | 1.5 | 2;
export type SaveState = "idle" | "saving" | "saved";

export interface HistoryEntry {
  segments: CaptionSegment[];
  captionStyle: CaptionStyle;
}

export interface EditorContextValue {
  project: Project | null;
  segments: CaptionSegment[];
  captionStyle: CaptionStyle;
  settings: ProjectSettings;
  originalSegments: CaptionSegment[];

  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  activeSegmentId: string | null;
  activeSegment: CaptionSegment | null;

  volume: number;
  isMuted: boolean;
  playbackRate: PlaybackRate;

  saveState: SaveState;
  isEditing: boolean;

  videoRef: React.RefObject<HTMLVideoElement | null>;
  registerVideo: (el: HTMLVideoElement | null) => void;

  setSegments: React.Dispatch<React.SetStateAction<CaptionSegment[]>>;
  setCaptionStyle: React.Dispatch<React.SetStateAction<CaptionStyle>>;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettings>>;
  setIsEditing: (v: boolean) => void;

  seekTo: (ms: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  setMuted: (v: boolean) => void;
  setPlaybackRate: (r: PlaybackRate) => void;
  stepFrame: (dir: -1 | 1) => void;

  updateSegment: (id: string, patch: Partial<CaptionSegment>) => void;
  deleteSegment: (id: string) => void;
  revertToOriginal: () => void;

  setCurrentTimeMs: (ms: number) => void;
  setDurationMs: (ms: number) => void;

  // ── Caption List extensions (PRD §4.5.2, §5.4) ───────────────────────────
  splitSegment: (id: string) => boolean;
  mergeSegment: (id: string) => boolean;
  addSegment: () => string | null;
  copySegmentText: (id: string) => void;

  // ── Undo / Redo (PRD §6) ───────────────────────────────────────────────
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pushHistory: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}

export function useEditorOptional(): EditorContextValue | null {
  return useContext(EditorContext);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Provider ───────────────────────────────────────────────────────────────

interface EditorProviderProps {
  initialProject: Project;
  children: React.ReactNode;
}

export function EditorProvider({ initialProject, children }: EditorProviderProps) {
  const [project, setProject] = useState<Project>(initialProject);
  const [segments, setSegments] = useState<CaptionSegment[]>(() => initialProject.segments ?? []);
  const [captionStyle, setCaptionStyleRaw] = useState<CaptionStyle>(() => initialProject.captionStyle);
  const [settings, setSettings] = useState<ProjectSettings>(() => initialProject.settings);
  const [originalSegments] = useState<CaptionSegment[]>(() => deepClone(initialProject.originalSegments ?? []));

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isEditing, setIsEditing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // ── Refs to keep current state for history stack (avoid stale closure) ──
  const segmentsRef = useRef<CaptionSegment[]>(segments);
  const captionStyleRef = useRef<CaptionStyle>(captionStyle);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    captionStyleRef.current = captionStyle;
  }, [captionStyle]);

  // ── Undo / Redo stacks (additive, PRD §6 depth 50) ─────────────────────
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyToast, setHistoryToast] = useState<string | null>(null);
  const lastPushRef = useRef<number>(0);
  const toastTimeoutRef = useRef<number | null>(null);
  // canUndo/canRedo derived from refs + version bump
  // eslint-disable-next-line react-hooks/refs -- stacks are refs for sync history; version bump triggers rerender
  const canUndo = undoStackRef.current.length > 0;
  // eslint-disable-next-line react-hooks/refs -- stacks are refs for sync history; version bump triggers rerender
  const canRedo = redoStackRef.current.length > 0;

  const showHistoryToast = useCallback((msg: string) => {
    setHistoryToast(msg);
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setHistoryToast(null), 1600);
  }, []);

  const doPush = useCallback(() => {
    const snap: HistoryEntry = {
      segments: deepClone(segmentsRef.current),
      captionStyle: deepClone(captionStyleRef.current),
    };
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    lastPushRef.current = Date.now();
  }, []);

  const pushHistory = useCallback(() => {
    doPush();
  }, [doPush]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const snap = undoStackRef.current.pop()!;
    const current: HistoryEntry = {
      segments: deepClone(segmentsRef.current),
      captionStyle: deepClone(captionStyleRef.current),
    };
    redoStackRef.current.push(current);
    // Avoid excedding 50 on redo as well? not needed but keep bounded
    if (redoStackRef.current.length > 50) redoStackRef.current.shift();
    setSegments(deepClone(snap.segments));
    setCaptionStyleRaw(deepClone(snap.captionStyle));
    setHistoryVersion((v) => v + 1);
    showHistoryToast("Undo");
  }, [showHistoryToast]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const snap = redoStackRef.current.pop()!;
    const current: HistoryEntry = {
      segments: deepClone(segmentsRef.current),
      captionStyle: deepClone(captionStyleRef.current),
    };
    undoStackRef.current.push(current);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    setSegments(deepClone(snap.segments));
    setCaptionStyleRaw(deepClone(snap.captionStyle));
    setHistoryVersion((v) => v + 1);
    showHistoryToast("Redo");
  }, [showHistoryToast]);

  // Wrapped setCaptionStyle that auto-pushes history per PRD §6 (style changes tracked)
  // UI-10: slider history bloat fix — caller must pushHistory() explicitly onPointerDown; we do NOT push per pixel here
  const setCaptionStyle = useCallback(
    (action: React.SetStateAction<CaptionStyle>) => {
      setCaptionStyleRaw(action);
    },
    []
  ) as React.Dispatch<React.SetStateAction<CaptionStyle>>;

  const registerVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    videoElRef.current = el;
    if (el) {
      try {
        el.volume = volume;
        el.muted = isMuted;
        el.playbackRate = playbackRate;
        if (!Number.isNaN(el.duration) && el.duration !== Infinity) {
          setDurationMs(el.duration * 1000);
        }
        setCurrentTimeMs(el.currentTime * 1000);
        setIsPlaying(!el.paused);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stable; deps handled via effects
  }, []);

  // Sync volume/muted/playbackRate to element when changed
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.playbackRate = playbackRate;
    } catch {}
  }, [playbackRate]);

  // Attach video event listeners when video element becomes available
  useEffect(() => {
    const v = videoElRef.current ?? videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      try {
        setCurrentTimeMs(v.currentTime * 1000);
      } catch {}
    };
    const onDuration = () => {
      try {
        if (!Number.isNaN(v.duration) && v.duration !== Infinity) setDurationMs(v.duration * 1000);
      } catch {}
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolume = () => {
      try {
        setVolume(v.volume);
        setIsMuted(v.muted);
      } catch {}
    };
    const onRate = () => {
      try {
        const r = v.playbackRate as PlaybackRate;
        if ([0.5, 1, 1.5, 2].includes(r)) setPlaybackRate(r);
      } catch {}
    };
    const onLoaded = () => {
      onDuration();
      onTimeUpdate();
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVolume);
    v.addEventListener("ratechange", onRate);

    // Also poll via rAF while playing for smooth captions (canvas can use rAF separately but time state benefits)
    let raf: number | null = null;
    const tick = () => {
      if (!v.paused && !v.ended) {
        try {
          setCurrentTimeMs(v.currentTime * 1000);
        } catch {}
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    };
    const startRaf = () => {
      if (raf === null && !v.paused) raf = requestAnimationFrame(tick);
    };
    const stopRaf = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };
    v.addEventListener("play", startRaf);
    v.addEventListener("pause", stopRaf);
    v.addEventListener("ended", stopRaf);
    // initial
    onDuration();
    if (!v.paused) startRaf();

    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("volumechange", onVolume);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("play", startRaf);
      v.removeEventListener("pause", stopRaf);
      v.removeEventListener("ended", stopRaf);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [registerVideo, project.id]); // re-bind if project changes

  // Active segment derived
  const activeSegment: CaptionSegment | null = useMemo(() => {
    for (const s of segments) {
      if (currentTimeMs >= s.startMs && currentTimeMs <= s.endMs) return s;
    }
    return null;
  }, [segments, currentTimeMs]);

  const activeSegmentId = activeSegment?.id ?? null;

  // Playback controls
  const seekTo = useCallback((ms: number) => {
    const v = videoRef.current;
    const effectiveDur = durationMs || (v && Number.isFinite(v.duration) && v.duration !== Infinity ? v.duration * 1000 : 0);
    const clamped = effectiveDur > 0 ? Math.max(0, Math.min(ms, effectiveDur)) : Math.max(0, ms);
    if (v) {
      try {
        // Ensure metadata loaded — if no duration, keep currentTime 0 and only update state
        if (!effectiveDur || Number.isNaN(v.duration) || v.duration === Infinity) {
          // Don't set Infinity; just update state
          if (clamped < 1_000_000) {
            try { v.currentTime = clamped / 1000; } catch {}
          }
          setCurrentTimeMs(clamped);
        } else {
          v.currentTime = clamped / 1000;
          setCurrentTimeMs(clamped);
        }
      } catch {
        setCurrentTimeMs(clamped);
      }
    } else {
      setCurrentTimeMs(clamped);
    }
  }, [durationMs]);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v) {
      setIsPlaying(true);
      return;
    }
    const p = v.play();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {
        // autoplay may be blocked; keep state consistent
        setIsPlaying(false);
      });
    }
  }, []);

  const pause = useCallback(() => {
    const v = videoRef.current;
    if (!v) {
      setIsPlaying(false);
      return;
    }
    v.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) {
      setIsPlaying((prev) => !prev);
      return;
    }
    if (v.paused) play();
    else pause();
  }, [play, pause]);

  const stepFrame = useCallback((dir: -1 | 1) => {
    if (isEditing) return;
    const delta = dir * 33; // ~33ms per frame (30fps)
    seekTo(currentTimeMs + delta);
  }, [isEditing, currentTimeMs, seekTo]);

  // Keyboard shortcuts global except when editing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextEditing = isEditing || (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));

      // Undo / Redo always handled even when editing? PRD says global, but we should not intercept when typing?
      // We allow Cmd+Z / Cmd+Shift+Z globally — check modifier first before isTextEditing return
      const cmdOrCtrl = e.ctrlKey || e.metaKey;
      if (cmdOrCtrl && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          // Redo is Cmd+Shift+Z or Ctrl+Y
          if (e.shiftKey) {
            e.preventDefault();
            redo();
            return;
          } else {
            e.preventDefault();
            undo();
            return;
          }
        }
        if (key === "y") {
          e.preventDefault();
          redo();
          return;
        }
      }

      if (isTextEditing) {
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepFrame(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, stepFrame, isEditing, undo, redo]);

  // ── Segment helpers with undo ─────────────────────────────────────────
  const updateSegment = useCallback((id: string, patch: Partial<CaptionSegment>) => {
    pushHistory();
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [pushHistory]);

  const deleteSegment = useCallback((id: string) => {
    // push before mutation for undo
    pushHistory();
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }, [pushHistory]);

  const splitSegment = useCallback((id: string): boolean => {
    const idx = segmentsRef.current.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const seg = segmentsRef.current[idx];
    if (!seg.words || seg.words.length < 2) {
      // Single word or empty — cannot split meaningfully if <2 words, but we still allow split? spec splits middle.
      // For single word, split is noop? We'll split text roughly half? But keep simple: disallow split if <2 words.
      // However for robustness, split empty or single word as middle — creates 2 halves of duration
      if (!seg.words || seg.words.length === 0) return false;
      if (seg.words.length === 1) return false;
    }

    const t = currentTimeMs;
    const words = seg.words;
    let splitIdx = -1;

    // Find first word at/after playhead
    if (t >= seg.startMs && t <= seg.endMs) {
      const found = words.findIndex((w) => w.startMs >= t);
      if (found > 0 && found < words.length) splitIdx = found;
      else if (found === 0) {
        // playhead before/at first word — try word where endMs > t
        const alt = words.findIndex((w) => w.endMs > t);
        if (alt > 0 && alt < words.length) splitIdx = alt;
      } else if (found === -1) {
        // t after all words start — maybe split before last?
        // fallback to middle below
      }
      // Edge: if splitIdx would leave empty side, fallback to middle
      if (splitIdx <= 0 || splitIdx >= words.length) splitIdx = -1;
    }

    if (splitIdx === -1) {
      // Split middle
      splitIdx = Math.ceil(words.length / 2);
      if (splitIdx <= 0 || splitIdx >= words.length) return false;
    }

    const w1 = words.slice(0, splitIdx);
    const w2 = words.slice(splitIdx);
    if (w1.length === 0 || w2.length === 0) return false;

    const text1 = w1.map((w) => w.word).join(" ");
    const text2 = w2.map((w) => w.word).join(" ");

    // Timing: use words timing; if missing, fallback to segment split at playhead
    const seg1End = w1[w1.length - 1]?.endMs ?? t;
    const seg2Start = w2[0]?.startMs ?? t;
    const confidences1 = w1.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
    const confidences2 = w2.map((w) => w.confidence).filter((c): c is number => typeof c === "number");

    const seg1: CaptionSegment = {
      id: seg.id,
      startMs: seg.startMs,
      endMs: seg1End,
      text: text1,
      words: w1.map((w) => ({ ...w })),
      confidence: confidences1.length ? Math.min(...confidences1) : undefined,
    };
    const seg2: CaptionSegment = {
      id: genId(),
      startMs: seg2Start,
      endMs: seg.endMs,
      text: text2,
      words: w2.map((w) => ({ ...w })),
      confidence: confidences2.length ? Math.min(...confidences2) : undefined,
    };

    // Ensure no overlap: clamp seg1.end to seg2.start (1ms gap) and validate ordering
    if (seg1.endMs >= seg2.startMs) {
      seg1.endMs = Math.max(seg1.startMs + 50, seg2.startMs - 1);
    }
    if (seg1.endMs <= seg1.startMs) seg1.endMs = seg1.startMs + 100;
    if (seg2.endMs <= seg2.startMs) seg2.endMs = seg2.startMs + 100;

    pushHistory();
    setSegments((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i === -1) return prev;
      const next = [...prev];
      next.splice(i, 1, seg1, seg2);
      // Keep sorted by startMs just in case
      next.sort((a, b) => a.startMs - b.startMs);
      return next;
    });
    return true;
  }, [pushHistory, currentTimeMs]);

  const mergeSegment = useCallback((id: string): boolean => {
    const segs = segmentsRef.current;
    // sorted by startMs to find "directly below" per PRD
    const sorted = [...segs].sort((a, b) => a.startMs - b.startMs);
    const idx = sorted.findIndex((s) => s.id === id);
    if (idx === -1 || idx >= sorted.length - 1) return false;
    const cur = sorted[idx];
    const nxt = sorted[idx + 1];

    const combinedWords = [...cur.words, ...nxt.words];
    const combinedText = [cur.text, nxt.text].filter(Boolean).join(" ").trim() || combinedWords.map((w) => w.word).join(" ");
    const confidences = combinedWords.map((w) => w.confidence).filter((c): c is number => typeof c === "number");

    const merged: CaptionSegment = {
      id: cur.id,
      startMs: cur.startMs,
      endMs: nxt.endMs,
      text: combinedText,
      words: combinedWords.map((w) => ({ ...w })),
      confidence: confidences.length ? Math.min(...confidences) : undefined,
    };

    pushHistory();
    setSegments((prev) => {
      // Remove nxt entirely, replace cur with merged
      const withoutNext = prev.filter((s) => s.id !== nxt.id);
      const next = withoutNext.map((s) => (s.id === id ? merged : s));
      next.sort((a, b) => a.startMs - b.startMs);
      return next;
    });
    return true;
  }, [pushHistory]);

  const addSegment = useCallback((): string | null => {
    const t = currentTimeMs;
    const vDur = durationMs || (videoRef.current && Number.isFinite(videoRef.current.duration) ? videoRef.current.duration * 1000 : 0);
    const dur = vDur > 0 ? vDur : 0;
    const start = dur ? Math.max(0, Math.min(t, Math.max(0, dur - 100))) : Math.max(0, t);
    const end = dur ? Math.min(start + 2000, dur) : start + 2000;
    // Ensure at least 500ms duration if near end, but clamp to duration when known
    let finalEnd = end <= start ? (dur ? dur : start + 2000) : end;
    if (dur && finalEnd > dur) finalEnd = dur;

    const newSeg: CaptionSegment = {
      id: genId(),
      startMs: start,
      endMs: finalEnd,
      text: "",
      words: [],
      confidence: undefined,
    };

    pushHistory();
    setSegments((prev) => {
      const next = [...prev, newSeg];
      next.sort((a, b) => a.startMs - b.startMs);
      return next;
    });
    // Optionally seek to new segment? Spec says insert at playhead with 2s duration, user types — keep playhead as is
    return newSeg.id;
  }, [pushHistory, currentTimeMs, durationMs]);

  const copySegmentText = useCallback((id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id);
    if (!seg) return;
    const text = seg.text;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {}
  }, []);

  const revertToOriginal = useCallback(() => {
    // PRD §6: Revert bypasses undo — hard reset and clears stack
    const cloned = deepClone(originalSegments);
    // Clear history stacks on revert per spec
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    setSegments(cloned);
    // Note: caller handles confirmation UI; we just reset
  }, [originalSegments]);

  // Wrapper setters for setVolume etc that also handle clamping
  const setVolumeClamped = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    // also update element if exists
    if (videoRef.current) videoRef.current.volume = clamped;
    if (clamped > 0 && isMuted) setIsMuted(false);
  }, [isMuted]);

  const setMutedWrapped = useCallback((m: boolean) => {
    setIsMuted(m);
    if (videoRef.current) videoRef.current.muted = m;
  }, []);

  const setPlaybackRateWrapped = useCallback((r: PlaybackRate) => {
    setPlaybackRate(r);
    if (videoRef.current) {
      try {
        videoRef.current.playbackRate = r;
      } catch {}
    }
  }, []);

  // ── Auto-save (debounced 800ms to Dexie per PRD §8.2) ───────────────────
  const saveTimeoutRef = useRef<number | null>(null);
  const savedFadeRef = useRef<number | null>(null);
  const isFirstRenderRef = useRef(true);

  // Keep project state in sync for header etc + lang/dir sync (UI-15/16)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived project state
    setProject((prev) => ({ ...prev, segments, captionStyle, settings }));
    try {
      const lang = settings.language;
      if (lang) {
        try { localStorage.setItem("capai_last_language", lang); } catch {}
        window.dispatchEvent(new CustomEvent("capai:language-changed", { detail: { language: lang } }));
        const rtl = lang === "ar" || lang === "he";
        document.documentElement.lang = lang;
        document.documentElement.dir = rtl ? "rtl" : "ltr";
      }
    } catch {}
  }, [segments, captionStyle, settings]);

  useEffect(() => {
    // Skip first render (initial load) — don't trigger saving immediately
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    setSaveState("saving");

    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        // PRD 8.2: videoBlob only written once on creation — use update to avoid rewriting blob
        await db.projects.update(project.id, {
          segments: deepClone(segments),
          captionStyle: deepClone(captionStyle),
          settings: deepClone(settings),
          updatedAt: Date.now(),
        } as Partial<Project>);
        setSaveState("saved");
        // Clear any pending staging on success
        try { localStorage.removeItem("capai_pending_save_" + project.id); } catch {}
        // Fade after 2s to idle
        savedFadeRef.current = window.setTimeout(() => setSaveState("idle"), 2000);
      } catch (err) {
        console.error("auto-save failed", err);
        setSaveState("idle");
        // UI-9: surface error to user instead of silent console only
        try {
          const msg = err instanceof Error ? err.message : String(err);
          window.dispatchEvent(new CustomEvent("capai:toast", { detail: { message: `Auto-save failed: ${msg}`, variant: "error" } }));
        } catch {}
      }
    }, 800);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [segments, captionStyle, settings, project.id]);

  // Beforeunload / pagehide / visibilitychange final save — synchronous staging + best-effort Dexie
  // IndexedDB tx is aborted on unload if void + not awaited; we stage to localStorage synchronously
  // and attempt a keepalive Dexie write, plus flush the debounced timer.
  useEffect(() => {
    const STAGING_PREFIX = "capai_pending_save_";
    const stageSynchronously = () => {
      try {
        const payload = {
          segments: deepClone(segments),
          captionStyle: deepClone(captionStyle),
          settings: deepClone(settings),
          updatedAt: Date.now(),
        };
        // Synchronous staging for recovery on next load (beforeunload-safe)
        try {
          localStorage.setItem(STAGING_PREFIX + project.id, JSON.stringify(payload));
        } catch {}
        // Also try to flush debounced save immediately (fire-and-forget but not void-aborted as much as possible)
        // Use sendBeacon-like: schedule microtask via navigator.sendBeacon fallback not applicable for IDB,
        // so we attempt db update without void — still best-effort.
        try {
          // Clear pending debounce so we don't double-write stale data on next tick
          if (saveTimeoutRef.current) {
            window.clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          // Attempt Dexie update — do not void; keep promise chain but don't await (browser may abort, but staging covers)
          const p = db.projects.update(project.id, {
            segments: payload.segments,
            captionStyle: payload.captionStyle,
            settings: payload.settings,
            updatedAt: payload.updatedAt,
          } as Partial<Project>);
          // Attach catch to prevent unhandled rejection
          if (p && typeof (p as Promise<unknown>).catch === "function") {
            (p as Promise<unknown>).catch(() => {});
          }
        } catch {}
      } catch {}
    };

    const handleBeforeUnload = () => {
      stageSynchronously();
    };
    const handlePageHide = () => {
      stageSynchronously();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stageSynchronously();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // On mount, check for previously staged pending save and apply it if newer
    try {
      const stagedRaw = localStorage.getItem(STAGING_PREFIX + project.id);
      if (stagedRaw) {
        try {
          const staged = JSON.parse(stagedRaw) as Partial<Project> & { updatedAt: number };
          if (staged.updatedAt && staged.updatedAt > (project.updatedAt ?? 0)) {
            void db.projects
              .update(project.id, {
                segments: staged.segments as Project["segments"],
                captionStyle: staged.captionStyle as Project["captionStyle"],
                settings: staged.settings as Project["settings"],
                updatedAt: staged.updatedAt,
              } as Partial<Project>)
              .then(() => {
                try {
                  localStorage.removeItem(STAGING_PREFIX + project.id);
                } catch {}
              })
              .catch(() => {});
          } else {
            try {
              localStorage.removeItem(STAGING_PREFIX + project.id);
            } catch {}
          }
        } catch {
          try {
            localStorage.removeItem(STAGING_PREFIX + project.id);
          } catch {}
        }
      }
    } catch {}

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [segments, captionStyle, settings, project.id, project.updatedAt]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const value: EditorContextValue = useMemo(
    () => ({
      project,
      segments,
      captionStyle,
      settings,
      originalSegments,
      currentTimeMs,
      durationMs,
      isPlaying,
      activeSegmentId,
      activeSegment,
      volume,
      isMuted,
      playbackRate,
      saveState,
      isEditing,
      videoRef,
      registerVideo,
      setSegments,
      setCaptionStyle,
      setSettings,
      setIsEditing,
      seekTo,
      play,
      pause,
      togglePlay,
      setVolume: setVolumeClamped,
      setMuted: setMutedWrapped,
      setPlaybackRate: setPlaybackRateWrapped,
      stepFrame,
      updateSegment,
      deleteSegment,
      revertToOriginal,
      setCurrentTimeMs,
      setDurationMs,
      splitSegment,
      mergeSegment,
      addSegment,
      copySegmentText,
      undo,
      redo,
      canUndo,
      canRedo,
      pushHistory,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      segments,
      captionStyle,
      settings,
      originalSegments,
      currentTimeMs,
      durationMs,
      isPlaying,
      activeSegmentId,
      activeSegment,
      volume,
      isMuted,
      playbackRate,
      saveState,
      isEditing,
      registerVideo,
      setSegments,
      setCaptionStyle,
      setSettings,
      seekTo,
      play,
      pause,
      togglePlay,
      setVolumeClamped,
      setMutedWrapped,
      setPlaybackRateWrapped,
      stepFrame,
      updateSegment,
      deleteSegment,
      revertToOriginal,
      splitSegment,
      mergeSegment,
      addSegment,
      copySegmentText,
      undo,
      redo,
      canUndo,
      canRedo,
      pushHistory,
      historyVersion,
    ]
  );

  return (
    <EditorContext.Provider value={value}>
      {children}
      {/* Subtle undo/redo toast per PRD §6 polish */}
      {historyToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-medium tracking-wide text-[var(--ink)] shadow-[0_8px_32px_rgba(0,0,0,0.45)] animate-[fade-in_140ms_ease-out]"
        >
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(12,10,9,0.08)] text-[11px] text-[var(--primary)]">
            {historyToast === "Undo" ? "↶" : "↷"}
          </span>
          {historyToast}
          <span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">{canUndo ? "↶ Z" : ""}{canUndo && canRedo ? " · " : ""}{canRedo ? "↷ Shift+Z" : ""}</span>
        </div>
      )}
    </EditorContext.Provider>
  );
}
