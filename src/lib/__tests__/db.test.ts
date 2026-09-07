import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { isValidThumbnailDataUrl, placeholderThumbnail } from "../thumbnail";
import { CapAIDatabase, db, sanitizeThumbnailDataUrl, saveProject, getAllProjects, createProject } from "../db";
import type { Project } from "../types";

function makeThumb(valid = true): string {
  if (valid) {
    // valid JPEG base64 >1000 chars
    return "data:image/jpeg;base64," + "A".repeat(1500);
  }
  return "data:image/jpeg;base64,/9j/"; // too short ~300
}

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = Date.now();
  return {
    id: `proj-${Math.random().toString(36).slice(2, 8)}`,
    name: "test-project.mp4",
    createdAt: now - 1000,
    updatedAt: now,
    videoBlob: new Blob(["fake video"], { type: "video/mp4" }),
    thumbnailDataUrl: makeThumb(true),
    settings: { mode: "dynamic", language: "en", wordsPerSegment: 3, rtl: false },
    captionStyle: {
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
    },
    segments: [
      { id: "s1", startMs: 0, endMs: 1000, text: "hello world", words: [{ word: "hello", startMs: 0, endMs: 500 }, { word: "world", startMs: 500, endMs: 1000 }] },
    ],
    originalSegments: [],
    ...overrides,
  };
}

describe("isValidThumbnailDataUrl", () => {
  it("validates JPEG >1000", () => {
    expect(isValidThumbnailDataUrl("data:image/jpeg;base64," + "A".repeat(1500))).toBe(true);
  });
  it("rejects JPEG too short (<1000)", () => {
    expect(isValidThumbnailDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(false);
    expect(isValidThumbnailDataUrl(makeThumb(false))).toBe(false);
  });
  it("rejects oversized >500k", () => {
    expect(isValidThumbnailDataUrl("data:image/jpeg;base64," + "A".repeat(600000))).toBe(false);
  });
  it("accepts SVG placeholder", () => {
    expect(isValidThumbnailDataUrl(placeholderThumbnail())).toBe(true);
    expect(isValidThumbnailDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
  });
  it("rejects non-string / empty / wrong prefix", () => {
    expect(isValidThumbnailDataUrl(null)).toBe(false);
    expect(isValidThumbnailDataUrl("")).toBe(false);
    expect(isValidThumbnailDataUrl("http://example.com/img.jpg")).toBe(false);
  });
});

describe("sanitizeThumbnailDataUrl", () => {
  it("returns url if valid", () => {
    const url = makeThumb(true);
    expect(sanitizeThumbnailDataUrl(url)).toBe(url);
  });
  it("returns null if invalid", () => {
    expect(sanitizeThumbnailDataUrl(makeThumb(false))).toBeNull();
    expect(sanitizeThumbnailDataUrl("invalid")).toBeNull();
  });
});

describe("Dexie v1->2 migration", () => {
  beforeEach(async () => {
    // Close and delete existing db
    try { db.close(); } catch {}
    // delete via Dexie
    await Dexie.delete("capai_db");
  });
  afterEach(async () => {
    try { db.close(); } catch {}
    await Dexie.delete("capai_db");
    // Re-open global db for other tests
    // Do not re-init here; vitest will handle fresh import
  });

  it("v1 projects survive upgrade to v2 and apiKeys table exists", async () => {
    // Create v1 db instance manually
    const v1 = new Dexie("capai_db");
    v1.version(1).stores({ projects: "id, name, createdAt, updatedAt" });
    await v1.open();
    const proj = makeProject({ id: "v1-proj" });
    await (v1 as Dexie).table("projects").put(proj as unknown as never);
    v1.close();

    // Now open v2 (CapAIDatabase) - should migrate without loss
    const v2 = new CapAIDatabase();
    await v2.open();
    const fetched = await v2.projects.get("v1-proj");
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe("v1-proj");
    expect(fetched?.name).toBe("test-project.mp4");
    // apiKeys table should exist and be empty
    const keys = await v2.apiKeys.toArray();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBe(0);
    // Can put an apiKey after migration
    await v2.apiKeys.put({ id: "k1", label: "Key 1", key: "AIza_test", isActive: true, priority: 0, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never);
    expect(await v2.apiKeys.count()).toBe(1);
    v2.close();
  });

  it("fresh install on v2 gets both stores without v1 data", async () => {
    const fresh = new CapAIDatabase();
    await fresh.open();
    expect(fresh.verno).toBe(2);
    await fresh.projects.put(makeProject({ id: "fresh1" }));
    expect(await fresh.projects.count()).toBe(1);
    fresh.close();
  });
});

describe("db persistence helpers", () => {
  beforeEach(async () => {
    try { db.close(); } catch {}
    await Dexie.delete("capai_db");
    // need to re-create db instance? Use global db but reopen
    await db.open();
    await db.projects.clear();
    await db.apiKeys.clear();
  });
  afterEach(async () => {
    await db.projects.clear();
    await db.apiKeys.clear();
  });

  it("saveProject sanitizes truncated thumbnail to placeholder", async () => {
    const proj = makeProject({ thumbnailDataUrl: makeThumb(false) });
    const id = await saveProject(proj);
    const fetched = await db.projects.get(id);
    expect(fetched?.thumbnailDataUrl).toBe(placeholderThumbnail());
  });
  it("saveProject clamps wordsPerSegment to 2-5", async () => {
    const proj = makeProject({ settings: { mode: "dynamic", language: "en", wordsPerSegment: 99 as unknown as 3, rtl: false } });
    // validate should throw before clamp? But saveProject clamps then validates. So it should succeed and clamp to 5
    const id = await saveProject(proj as unknown as Project);
    const fetched = await db.projects.get(id);
    expect([2,3,4,5]).toContain(fetched?.settings.wordsPerSegment);
  });
  it("getAllProjects sorted by updatedAt desc", async () => {
    const now = Date.now();
    await db.projects.bulkPut([
      makeProject({ id: "p1", updatedAt: now - 3000, createdAt: now - 3000 }),
      makeProject({ id: "p2", updatedAt: now - 1000, createdAt: now - 1000 }),
      makeProject({ id: "p3", updatedAt: now - 2000, createdAt: now - 2000 }),
    ]);
    const all = await getAllProjects();
    expect(all.map(p=>p.id)).toEqual(["p2","p3","p1"]);
  });
  it("saveProject rejects QuotaExceededError with friendly message", async () => {
    const spy = vi.spyOn(db.projects, "put").mockRejectedValueOnce(Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" }));
    await expect(saveProject(makeProject())).rejects.toThrow(/Storage quota exceeded/);
    spy.mockRestore();
    // Ensure original still works
    await expect(saveProject(makeProject({ id: "after-quota"}))).resolves.toBe("after-quota");
  });
  it("createProject throws on duplicate id ConstraintError", async () => {
    const proj = makeProject({ id: "dup-id" });
    await createProject(proj);
    await expect(createProject(proj)).rejects.toThrow(/already exists/);
  });
  it("saveProject validates videoBlob size and segments sorted", async () => {
    const proj = makeProject({
      segments: [
        { id: "s2", startMs: 1000, endMs: 2000, text: "b", words: [] },
        { id: "s1", startMs: 0, endMs: 500, text: "a", words: [] },
      ]
    });
    const id = await saveProject(proj);
    const fetched = await db.projects.get(id);
    // Should be sorted
    expect(fetched?.segments[0].id).toBe("s1");
  });
  it("Blob.size validation: zero-size Blob still saves? should allow but export will later reject", async () => {
    const emptyBlob = new Blob([], { type: "video/mp4" });
    expect(emptyBlob.size).toBe(0);
    const proj = makeProject({ videoBlob: emptyBlob });
    // saveProject should succeed (db stores blob regardless), but export logic elsewhere will reject on size 0
    const id = await saveProject(proj);
    const fetched = await db.projects.get(id);
    // fake-indexeddb may store Blob as plain object; check size if present, else check that videoBlob exists
    if (fetched?.videoBlob && typeof (fetched.videoBlob as Blob).size === "number") {
      expect((fetched.videoBlob as Blob).size).toBe(0);
    } else {
      expect(fetched?.videoBlob).toBeDefined();
    }
  });
});
