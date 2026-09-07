import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFFMethods = vi.hoisted(() => {
  const exec = vi.fn(async () => 0);
  const writeFile = vi.fn(async () => undefined);
  const readFile = vi.fn(async (path: string) => {
    if (path.includes("output")) return new Uint8Array(60000);
    if (path.includes("subtitles")) return new TextEncoder().encode("[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n");
    return new Uint8Array([1]);
  });
  const deleteFile = vi.fn(async () => undefined);
  const createDir = vi.fn(async () => undefined);
  const listDir = vi.fn(async () => ["Inter-Regular.ttf"]);
  const on = vi.fn();
  const off = vi.fn();
  const load = vi.fn(async () => undefined);
  const terminate = vi.fn();
  return { exec, writeFile, readFile, deleteFile, createDir, listDir, on, off, load, terminate };
});

// Use hoisted mock class
vi.mock("@ffmpeg/ffmpeg", () => {
  return {
    FFmpeg: class {
      on = mockFFMethods.on;
      off = mockFFMethods.off;
      load = mockFFMethods.load;
      exec = mockFFMethods.exec;
      writeFile = mockFFMethods.writeFile;
      readFile = mockFFMethods.readFile;
      deleteFile = mockFFMethods.deleteFile;
      createDir = mockFFMethods.createDir;
      listDir = mockFFMethods.listDir as unknown as never;
      terminate = mockFFMethods.terminate;
    },
  };
});

vi.mock("@ffmpeg/util", () => ({
  fetchFile: vi.fn(async () => new Uint8Array([1,2,3,4])),
  toBlobURL: vi.fn(async (url: string) => url),
}));

vi.mock("../ffmpegConfig", () => ({
  CORE_VERSION: "0.12.10",
  CORE_BASE: "/ffmpeg",
  CORE_BASE_ESM: "/ffmpeg",
}));

import { getExportFilename, exportVideo, resetExportFFmpeg } from "../export";
import type { CaptionStyle, CaptionSegment } from "../types";

function makeStyle(): CaptionStyle {
  return {
    preset: "Reels",
    fontFamily: "Montserrat",
    fontSize: 48,
    fontWeight: 400,
    fontStyle: "normal",
    textTransform: "none",
    textAlign: "center",
    color: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 1,
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    pillEnabled: false,
    pillColor: "#000000",
    pillOpacity: 0.5,
    pillPaddingX: 4,
    pillPaddingY: 4,
    pillRadius: 4,
    highlightStyle: "karaoke",
    activeWordColor: "#FFD700",
    inactiveWordColor: "#FFFFFF",
    positionPreset: "bottom",
    positionOffsetY: 0,
    hAlign: "center",
  };
}

function makeSegments(n = 1): CaptionSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    startMs: i * 1000,
    endMs: i * 1000 + 800,
    text: "hello world",
    words: [{ word: "hello", startMs: i*1000, endMs: i*1000+400 }, { word: "world", startMs: i*1000+400, endMs: i*1000+800 }],
  }));
}

describe("getExportFilename", () => {
  it("strips extension and appends _captioned.mp4", () => {
    expect(getExportFilename("my video.mp4")).toBe("my video_captioned.mp4");
    expect(getExportFilename("test.MOV")).toBe("test_captioned.mp4");
  });
  it("sanitizes unsafe chars", () => {
    expect(getExportFilename("a/b?c.mp4")).toBe("a_b_c_captioned.mp4");
  });
  it("truncates >80", () => {
    const name = "a".repeat(100) + ".mp4";
    expect(getExportFilename(name).length).toBeLessThanOrEqual("_captioned.mp4".length + 80);
  });
  it("fallback to video if empty", () => {
    expect(getExportFilename("")).toBe("video_captioned.mp4");
  });
});

describe("exportVideo — integration with mocked FFmpeg", () => {
  beforeEach(async () => {
    resetExportFFmpeg();
    mockFFMethods.exec.mockReset();
    mockFFMethods.exec.mockResolvedValue(0);
    mockFFMethods.readFile.mockReset();
    mockFFMethods.readFile.mockImplementation(async (path: string) => {
      if (path.includes("output")) return new Uint8Array(60000);
      if (path.includes("subtitles")) return new TextEncoder().encode("[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n");
      return new Uint8Array([1]);
    });
    mockFFMethods.writeFile.mockReset();
    mockFFMethods.writeFile.mockResolvedValue(undefined);
    mockFFMethods.listDir.mockReset();
    mockFFMethods.listDir.mockResolvedValue(["Inter-Regular.ttf"] as unknown as never);
    // Mock font fetch
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => "font/ttf" },
      arrayBuffer: async () => new Uint8Array(150000).buffer,
    } as unknown as Response)) as unknown as typeof fetch;
  });

  afterEach(() => {
    resetExportFFmpeg();
  });

  it("throws on zero-size videoBlob", async () => {
    await expect(exportVideo({
      videoBlob: new Blob([], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 1280,
      videoHeight: 720,
    })).rejects.toThrow(/No video data/);
  });

  it("throws if dimensions missing and getVideoMetadata fails", async () => {
    // Provide a Blob but no dims; in jsdom getVideoMetadata will try to create video element and timeout after 8s.
    // To make test fast, we mock getVideoMetadata path by forcing document to be undefined? Instead we pass dims check via not providing dims but global fetch will not help.
    // We expect rejection; set timeout high
    const promise = exportVideo({
      videoBlob: new Blob(["fake"], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
    });
    await expect(promise).rejects.toThrow(/Could not detect video dimensions/);
  }, 15000);

  it("abort before start throws AbortError", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(exportVideo({
      videoBlob: new Blob(["x".repeat(1000)], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 640,
      videoHeight: 480,
      signal: ac.signal,
    })).rejects.toThrow();
  });

  it("minBytes guard: output too small throws", async () => {
    mockFFMethods.readFile.mockImplementation(async (path: string) => {
      if (path.includes("output")) return new Uint8Array(500);
      if (path.includes("subtitles")) return new TextEncoder().encode("[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n");
      return new Uint8Array([1]);
    });
    await expect(exportVideo({
      videoBlob: new Blob(["x".repeat(60000)], { type: "video/mp4" }),
      segments: makeSegments(2),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 1280,
      videoHeight: 720,
      durationMs: 10000,
    })).rejects.toThrow(/output too small/i);
  });

  it("identical size guard: output size within 5KB of input throws", async () => {
    const inputSize = 60000;
    mockFFMethods.readFile.mockImplementation(async (path: string) => {
      if (path.includes("output")) return new Uint8Array(59000);
      if (path.includes("subtitles")) return new TextEncoder().encode("[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n");
      return new Uint8Array([1]);
    });
    await expect(exportVideo({
      videoBlob: new Blob(["x".repeat(inputSize)], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 640,
      videoHeight: 480,
      durationMs: 10000,
    })).rejects.toThrow(/appears unprocessed/i);
  });

  it("tryExec fallback: first vf fails (ass), second (subtitles) succeeds", async () => {
    let calls = 0;
    mockFFMethods.exec.mockImplementation(async () => {
      calls++;
      return calls === 1 ? 1 : 0;
    });
    // Make output size differ to avoid identical guard
    mockFFMethods.readFile.mockImplementation(async (path: string) => {
      if (path.includes("output")) return new Uint8Array(70000);
      if (path.includes("subtitles")) return new TextEncoder().encode("[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n");
      return new Uint8Array([1]);
    });
    let logCb: ((e: { message: string }) => void) | null = null;
    mockFFMethods.on.mockImplementation((ev: string, cb: (e: { message: string }) => void) => {
      if (ev === "log") logCb = cb;
    });
    setTimeout(() => logCb?.({ message: "No such filter: ass" }), 5);

    const result = await exportVideo({
      videoBlob: new Blob(["x".repeat(60000)], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 640,
      videoHeight: 480,
      durationMs: 10000,
    });
    expect(result.blob.size).toBeGreaterThan(0);
    expect(mockFFMethods.exec).toHaveBeenCalledTimes(2);
    mockFFMethods.on.mockReset();
  });

  it("both tryExec fail with filter message => throws friendly error", async () => {
    let logCb: ((e: { message: string }) => void) | null = null;
    mockFFMethods.on.mockImplementation((ev: string, cb: (e: { message: string }) => void) => {
      if (ev === "log") logCb = cb;
    });
    mockFFMethods.exec.mockImplementation(async () => {
      logCb?.({ message: "No such filter: ass" });
      logCb?.({ message: "Unable to open ass" });
      return 1;
    });
    await expect(exportVideo({
      videoBlob: new Blob(["x".repeat(60000)], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 640,
      videoHeight: 480,
      durationMs: 10000,
    })).rejects.toThrow(/FFmpeg build does not support ASS/);
    mockFFMethods.on.mockReset();
  });

  it("abort during exec resets and throws (via AbortSignal)", async () => {
    const ac = new AbortController();
    // Make writeFile slow so abort can be detected after it but before exec
    const origWrite = mockFFMethods.writeFile.getMockImplementation();
    mockFFMethods.writeFile.mockImplementation(async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 200));
      if (origWrite) return (origWrite as unknown as (...a: unknown[]) => Promise<void>)(...args);
      return undefined;
    });
    const promise = exportVideo({
      videoBlob: new Blob(["x".repeat(60000)], { type: "video/mp4" }),
      segments: makeSegments(1),
      style: makeStyle(),
      mode: "static",
      projectName: "test.mp4",
      videoWidth: 640,
      videoHeight: 480,
      durationMs: 10000,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 50);
    await expect(promise).rejects.toThrow(/Abort|cancell?ed/i);
    mockFFMethods.writeFile.mockReset();
    mockFFMethods.writeFile.mockResolvedValue(undefined as never);
  }, 8000);
});
