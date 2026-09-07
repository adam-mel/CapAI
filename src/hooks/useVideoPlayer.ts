"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorOptional } from "@/context/EditorContext";

/**
 * CapAI — useVideoPlayer hook
 * Manages HTMLVideoElement playback state with smooth time updates.
 * Can be used standalone with a videoRef, or will delegate to EditorContext if available.
 */

export type PlaybackRate = 0.5 | 1 | 1.5 | 2;

export interface UseVideoPlayerOptions {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export interface UseVideoPlayerReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  playbackRate: PlaybackRate;
  seekTo: (ms: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (r: PlaybackRate) => void;
  stepFrame: (dir: -1 | 1) => void;
}

/**
 * Standalone + context-aware hook.
 * Hooks are called unconditionally to satisfy Rules of Hooks; if EditorContext
 * is present and no external ref is requested, we proxy to the context values.
 */
export function useVideoPlayer(options?: UseVideoPlayerOptions): UseVideoPlayerReturn {
  const ctx = useEditorOptional();
  const externalRef = options?.videoRef;

  // Always call hooks first (Rules of Hooks)
  const localRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = (externalRef ?? localRef) as React.RefObject<HTMLVideoElement | null>;

  const [isPlayingLocal, setIsPlaying] = useState(false);
  const [currentTimeMsLocal, setCurrentTimeMs] = useState(0);
  const [durationMsLocal, setDurationMs] = useState(0);
  const [volumeLocal, setVolumeState] = useState(1);
  const [isMutedLocal, setIsMutedState] = useState(false);
  const [playbackRateLocal, setPlaybackRateState] = useState<PlaybackRate>(1);

  // Bind events to the video element when it mounts (always runs)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => setCurrentTimeMs(v.currentTime * 1000);
    const onDur = () => {
      if (!Number.isNaN(v.duration) && v.duration !== Infinity) setDurationMs(v.duration * 1000);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVol = () => {
      setVolumeState(v.volume);
      setIsMutedState(v.muted);
    };
    const onRate = () => {
      const r = v.playbackRate as PlaybackRate;
      if ([0.5, 1, 1.5, 2].includes(r)) setPlaybackRateState(r);
    };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("ratechange", onRate);

    let raf: number | null = null;
    const tick = () => {
      if (!v.paused) {
        setCurrentTimeMs(v.currentTime * 1000);
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    };
    const start = () => {
      if (raf === null && !v.paused) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };
    v.addEventListener("play", start);
    v.addEventListener("pause", stop);
    v.addEventListener("ended", stop);
    onDur();
    if (!v.paused) start();

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("play", start);
      v.removeEventListener("pause", stop);
      v.removeEventListener("ended", stop);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [videoRef]);

  const seekToLocal = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      if (!v) return;
      const clamped = Math.max(0, Math.min(ms, durationMsLocal || Number.MAX_SAFE_INTEGER));
      try {
        v.currentTime = clamped / 1000;
        setCurrentTimeMs(clamped);
      } catch {
        setCurrentTimeMs(clamped);
      }
    },
    [durationMsLocal, videoRef]
  );

  const playLocal = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const p = v.play();
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => setIsPlaying(false));
  }, [videoRef]);

  const pauseLocal = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
  }, [videoRef]);

  const togglePlayLocal = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) playLocal();
    else pauseLocal();
  }, [playLocal, pauseLocal, videoRef]);

  const setVolumeLocal = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolumeState(clamped);
      const el = videoRef.current;
      if (el) el.volume = clamped;
      if (clamped > 0 && isMutedLocal) setIsMutedState(false);
    },
    [isMutedLocal, videoRef]
  );

  const toggleMuteLocal = useCallback(() => {
    const next = !isMutedLocal;
    setIsMutedState(next);
    const el = videoRef.current;
    if (el) el.muted = next;
  }, [isMutedLocal, videoRef]);

  const setPlaybackRateLocal = useCallback(
    (r: PlaybackRate) => {
      setPlaybackRateState(r);
      const el = videoRef.current;
      if (el) {
        try {
          el.playbackRate = r;
        } catch {}
      }
    },
    [videoRef]
  );

  const stepFrameLocal = useCallback(
    (dir: -1 | 1) => {
      const delta = dir * 33;
      seekToLocal(currentTimeMsLocal + delta);
    },
    [currentTimeMsLocal, seekToLocal]
  );

  // If context exists and no external ref requested, delegate to context (hooks already called above)
  if (ctx && !externalRef) {
    return {
      videoRef: ctx.videoRef,
      isPlaying: ctx.isPlaying,
      currentTimeMs: ctx.currentTimeMs,
      durationMs: ctx.durationMs,
      volume: ctx.volume,
      isMuted: ctx.isMuted,
      playbackRate: ctx.playbackRate,
      seekTo: ctx.seekTo,
      play: ctx.play,
      pause: ctx.pause,
      togglePlay: ctx.togglePlay,
      setVolume: ctx.setVolume,
      toggleMute: () => ctx.setMuted(!ctx.isMuted),
      setPlaybackRate: ctx.setPlaybackRate,
      stepFrame: ctx.stepFrame,
    };
  }

  return {
    videoRef,
    isPlaying: isPlayingLocal,
    currentTimeMs: currentTimeMsLocal,
    durationMs: durationMsLocal,
    volume: volumeLocal,
    isMuted: isMutedLocal,
    playbackRate: playbackRateLocal,
    seekTo: seekToLocal,
    play: playLocal,
    pause: pauseLocal,
    togglePlay: togglePlayLocal,
    setVolume: setVolumeLocal,
    toggleMute: toggleMuteLocal,
    setPlaybackRate: setPlaybackRateLocal,
    stepFrame: stepFrameLocal,
  };
}

export default useVideoPlayer;
