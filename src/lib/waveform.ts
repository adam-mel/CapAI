/**
 * CapAI — waveform utilities
 * PRD §4.5.4 — extract audio buffer → downsampled waveform points
 *
 * Uses Web Audio API decodeAudioData on the video Blob.
 * Falls back to deterministic pseudo-waveform if decode fails or not in browser.
 */

export type WaveformData = number[]; // 0..1 normalized amplitudes

/**
 * Downsample a Float32Array to targetPoints using max + RMS blend.
 * Returns normalized 0..1 values.
 */
export function downsampleChannelData(
  channelData: Float32Array,
  targetPoints = 800
): number[] {
  const len = channelData.length;
  if (len === 0) return [];
  if (len <= targetPoints) {
    // Already small — just normalize absolute values
    let max = 0;
    for (let i = 0; i < len; i++) max = Math.max(max, Math.abs(channelData[i]));
    const out: number[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = max > 0 ? Math.abs(channelData[i]) / max : 0;
    // Pad or fit to targetPoints by linear interpolation if needed?
    // Just return as is
    return out;
  }

  const samplesPerBucket = Math.floor(len / targetPoints);
  const result: number[] = new Array(targetPoints);

  for (let i = 0; i < targetPoints; i++) {
    const start = i * samplesPerBucket;
    const end = i === targetPoints - 1 ? len : start + samplesPerBucket;
    let max = 0;
    let sumSq = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      const av = Math.abs(v);
      if (av > max) max = av;
      sumSq += v * v;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    // Blend max (peak) and rms for visual balance
    const blended = max * 0.65 + rms * 0.35;
    result[i] = blended;
  }

  // Normalize to 0..1 based on global max
  let globalMax = 0;
  for (let i = 0; i < result.length; i++) if (result[i] > globalMax) globalMax = result[i];
  if (globalMax > 0) {
    for (let i = 0; i < result.length; i++) result[i] = Math.min(1, result[i] / globalMax);
  }

  // Apply light smoothing via moving average 3
  const smoothed = result.slice();
  for (let i = 1; i < result.length - 1; i++) {
    smoothed[i] = (result[i - 1] * 0.2 + result[i] * 0.6 + result[i + 1] * 0.2);
  }

  // Ensure tiny floor so bars are visible even in silence
  for (let i = 0; i < smoothed.length; i++) {
    // keep at least 0.06 for visual baseline
    smoothed[i] = Math.max(0.06, smoothed[i]);
    // Clamp
    if (smoothed[i] > 1) smoothed[i] = 1;
  }

  return smoothed;
}

/**
 * Deterministic pseudo waveform (no Math.random, for SSR / fallback)
 * Uses sine + pseudo-random based on index
 */
export function generateFallbackWaveform(targetPoints = 800): number[] {
  const out: number[] = new Array(targetPoints);
  for (let i = 0; i < targetPoints; i++) {
    const pseudo = ((i * 9301 + 49297) % 233280) / 233280;
    const sine = Math.abs(Math.sin((i * 0.14 + 1) * 1.8)) * 0.55;
    const sine2 = Math.abs(Math.sin(i * 0.03)) * 0.15;
    const h = 0.18 + sine + sine2 + pseudo * 0.12;
    out[i] = Math.min(1, Math.max(0.08, h));
  }
  return out;
}

// Throttle decode-failed warnings — one per Blob identity to avoid console spam
const warnedWaveformBlobs = new WeakSet<Blob>();
let waveformGlobalWarned = false;

/**
 * Extract waveform data from a video/audio Blob via Web Audio API.
 * @param blob - video Blob from project
 * @param targetPoints - desired number of bars (default 800)
 */
export async function extractWaveformData(
  blob: Blob,
  targetPoints = 800
): Promise<WaveformData> {
  if (typeof window === "undefined") {
    return generateFallbackWaveform(targetPoints);
  }

  // Guard: empty blob
  if (!blob || blob.size === 0) {
    return generateFallbackWaveform(targetPoints);
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return generateFallbackWaveform(targetPoints);

    const AudioCtor: typeof AudioContext | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return generateFallbackWaveform(targetPoints);

    const audioCtx = new AudioCtor();

    // decodeAudioData may be callback-based in some browsers; wrap
    const decoded: AudioBuffer = await new Promise((resolve, reject) => {
      // Modern promise API
      const maybePromise = (audioCtx as AudioContext).decodeAudioData(
        arrayBuffer.slice(0),
        (buf) => resolve(buf),
        (err) => reject(err)
      );
      // If promise returned, hook it
      if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === "function") {
        (maybePromise as Promise<AudioBuffer>).then(resolve, reject);
      }
    });

    // Mix down channels or take first
    let channelData: Float32Array;
    if (decoded.numberOfChannels === 1) {
      channelData = decoded.getChannelData(0);
    } else {
      // Mix to mono by averaging
      const length = decoded.length;
      channelData = new Float32Array(length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < length; i++) channelData[i] += data[i] / decoded.numberOfChannels;
      }
    }

    const downsampled = downsampleChannelData(channelData, targetPoints);

    // Cleanup
    try {
      if (typeof audioCtx.close === "function") await audioCtx.close();
    } catch {
      // ignore
    }

    if (downsampled.length === 0) return generateFallbackWaveform(targetPoints);
    return downsampled;
  } catch (err) {
    // Throttled: warn once per Blob identity, otherwise debug, to avoid 2× spam for invalid video
    let shouldWarn = false;
    try {
      if (!warnedWaveformBlobs.has(blob)) {
        warnedWaveformBlobs.add(blob);
        shouldWarn = true;
      }
    } catch {
      if (!waveformGlobalWarned) {
        waveformGlobalWarned = true;
        shouldWarn = true;
      }
    }
    if (shouldWarn) {
      console.warn("[waveform] decode failed, using fallback", err);
    } else {
      console.debug("[waveform] decode failed (throttled)", err);
    }
    return generateFallbackWaveform(targetPoints);
  }
}

/**
 * Convenience: extract with caching per Blob identity (weak map)
 * Not strictly required but avoids repeated decode when switching tabs.
 */
const cache = new WeakMap<Blob, WaveformData>();

export async function getWaveformDataCached(
  blob: Blob,
  targetPoints = 800
): Promise<WaveformData> {
  const cached = cache.get(blob);
  if (cached && cached.length === targetPoints) return cached;
  const data = await extractWaveformData(blob, targetPoints);
  try {
    cache.set(blob, data);
  } catch {}
  return data;
}

/**
 * Map a time (ms) to a ratio 0..1 given durationMs
 */
export function timeToRatio(ms: number, durationMs: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, ms / durationMs));
}

/**
 * Map a ratio 0..1 to time ms
 */
export function ratioToTime(ratio: number, durationMs: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.max(0, Math.min(durationMs, ratio * durationMs));
}
