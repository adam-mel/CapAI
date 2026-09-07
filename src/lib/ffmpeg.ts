/**
 * CapAI — FFmpeg.wasm audio extraction
 * PRD §11.1 — extractAudio(videoFile) -> { base64, mimeType }
 * Uses @ffmpeg/ffmpeg v0.12 + @ffmpeg/util. Falls back with clear error if load fails.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { CORE_BASE, CORE_BASE_ESM, CORE_VERSION } from "./ffmpegConfig";

// Two singletons (audio + export) intentionally separate — see ffmpegConfig.ts header.
// Audio extraction singleton isolated from export to avoid abort/terminate collision.

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// CORE_VERSION / CORE_BASE unified via ./ffmpegConfig (0.12.10 with libass+fonts)
void CORE_VERSION;

async function tryLoadWith(
  ffmpeg: FFmpeg,
  coreURL: string,
  wasmURL: string
): Promise<void> {
  await ffmpeg.load({
    coreURL: await toBlobURL(coreURL, "text/javascript"),
    wasmURL: await toBlobURL(wasmURL, "application/wasm"),
  });
}

/**
 * Singleton loader for FFmpeg.wasm.
 * Attempts UMD then ESM core; throws descriptive error if both fail.
 */
export async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("FFmpeg can only run in the browser.");
    }

    const ff = new FFmpeg();
    // Enable logs to surface codec/filter issues (e.g., libmp3lame missing)
    ff.on("log", ({ type, message }) => console.debug("[ffmpeg-audio]", type, message));

    const attempts: Array<{ core: string; wasm: string; label: string }> = [
      { core: `${CORE_BASE}/ffmpeg-core.js`, wasm: `${CORE_BASE}/ffmpeg-core.wasm`, label: "local UMD" },
      { core: `${CORE_BASE_ESM}/ffmpeg-core.js`, wasm: `${CORE_BASE_ESM}/ffmpeg-core.wasm`, label: "local ESM" },
      { core: `/ffmpeg/ffmpeg-core.esm.js`, wasm: `/ffmpeg/ffmpeg-core.esm.wasm`, label: "local ESM alt" },
      { core: `/ffmpeg/esm/ffmpeg-core.js`, wasm: `/ffmpeg/esm/ffmpeg-core.wasm`, label: "local ESM subfolder" },
      { core: `/ffmpeg/umd/ffmpeg-core.js`, wasm: `/ffmpeg/umd/ffmpeg-core.wasm`, label: "local UMD subfolder" },
    ];

    let lastErr: unknown = null;
    for (const a of attempts) {
      try {
        await tryLoadWith(ff, a.core, a.wasm);
        ffmpegInstance = ff;
        return ff;
      } catch (e) {
        lastErr = e;
        // Try next CDN variant
      }
    }

    const isCoopError =
      lastErr instanceof Error &&
      /SharedArrayBuffer|COOP|COEP|cross-origin/i.test(lastErr.message);

    if (isCoopError) {
      throw new Error(
        "FFmpeg failed to load due to browser security headers (COOP/COEP). Ensure the dev server sets Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp, then hard-refresh. Details: " +
          (lastErr instanceof Error ? lastErr.message : String(lastErr))
      );
    }

    throw new Error(
      `FFmpeg failed to load. Check your network and try again. (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`
    );
  })();

  try {
    const inst = await loadPromise;
    return inst;
  } catch (e) {
    // Reset so retry is possible
    loadPromise = null;
    throw e;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Chunked without spread to avoid "Maximum call stack size exceeded" on large audio (~60 MB)
  // String.fromCharCode(...chunk) with 32k args can overflow V8's arg limit; use explicit loop.
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let chunkStr = "";
    // manual loop avoids spread/apply arg-limit
    for (let j = 0; j < chunk.length; j++) {
      chunkStr += String.fromCharCode(chunk[j]);
    }
    binary += chunkStr;
  }
  return btoa(binary);
}

function getInputName(file: File | Blob): string {
  if (file instanceof File && file.name) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    // Sanitize ext to safe set
    const safe = ["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext) ? ext : "mp4";
    return `input.${safe}`;
  }
  // Heuristic from MIME
  const t = (file as Blob).type || "";
  if (t.includes("webm")) return "input.webm";
  if (t.includes("quicktime")) return "input.mov";
  if (t.includes("matroska") || t.includes("mkv")) return "input.mkv";
  return "input.mp4";
}

/**
 * Extract audio track from video as base64 mp3.
 * Requires browser with FFmpeg.wasm support.
 */
export async function extractAudio(
  videoFile: File | Blob
): Promise<{ base64: string; mimeType: string }> {
  const ffmpeg = await loadFFmpeg();

  // Per-call UUID avoids concurrent extractAudio races on shared MEMFS (BUG-LOGIC-4)
  const runId = (() => {
    try { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8); } catch {}
    return Math.random().toString(36).slice(2, 10);
  })();
  const baseInput = getInputName(videoFile);
  const inputName = `audio-${runId}-${baseInput}`;
  const outputName = `output-${runId}.mp3`;

  // Clean any previous outputs (ignore errors)
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    // file may not exist
  }
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    // ignore
  }

  // Write input
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
  } catch (e) {
    throw new Error(
      `Failed to load video into FFmpeg: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Try primary encode (mp3)
  let execCode = -1;
  let lastExecError: unknown = null;

  const mp3Args = [
    "-i",
    inputName,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-b:a",
    "64k",
    outputName,
  ];

  try {
    execCode = await ffmpeg.exec(mp3Args);
  } catch (e) {
    lastExecError = e;
    execCode = 1;
  }

  // Fallback to AAC if mp3 failed
  if (execCode !== 0) {
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
    const aacArgs = ["-i", inputName, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "aac", "-b:a", "64k", outputName];
    try {
      execCode = await ffmpeg.exec(aacArgs);
      if (execCode !== 0) throw new Error(`AAC encode exit ${execCode}`);
      // Success with AAC
      let data: Uint8Array;
      try {
        const fileData = await ffmpeg.readFile(outputName);
        data = fileData as Uint8Array;
      } catch (e) {
        throw new Error(`Failed to read AAC output: ${e instanceof Error ? e.message : String(e)}`);
      }
      const base64 = uint8ToBase64(data);
      // Cleanup
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {}
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {}
      return { base64, mimeType: "audio/aac" };
    } catch (e) {
      lastExecError = e;
      // fall through to throw
    }
  }

  if (execCode !== 0) {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {}
    throw new Error(
      `Audio extraction failed (ffmpeg exit ${execCode}). ${lastExecError instanceof Error ? lastExecError.message : String(lastExecError ?? "")} Try a smaller or different video file.`
    );
  }

  // Read mp3 output
  let data: Uint8Array;
  try {
    const fileData = await ffmpeg.readFile(outputName);
    // readFile may return string for text files, but mp3 is binary -> Uint8Array
    if (typeof fileData === "string") {
      // Convert string to bytes (unlikely for mp3)
      data = new TextEncoder().encode(fileData);
    } else {
      data = fileData as Uint8Array;
    }
  } catch (e) {
    throw new Error(`Failed to read extracted audio: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!data || data.length === 0) {
    throw new Error("Extracted audio was empty. The video may have no audio track.");
  }

  const base64 = uint8ToBase64(data);

  // Cleanup virtual FS (best effort)
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {}
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {}

  return { base64, mimeType: "audio/mpeg" };
}
