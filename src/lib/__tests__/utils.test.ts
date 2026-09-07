import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTime, parseTime, relativeTime, truncateFilename, formatFileSize } from "../utils";

describe("formatTime / parseTime round-trip", () => {
  it("formatTime 0 => 00:00.000", () => {
    expect(formatTime(0)).toBe("00:00.000");
  });
  it("formatTime 2140 => 00:02.140", () => {
    expect(formatTime(2140)).toBe("00:02.140");
  });
  it("formatTime 61000 => 01:01.000", () => {
    expect(formatTime(61000)).toBe("01:01.000");
  });
  it("parseTime MM:SS.mmm", () => {
    expect(parseTime("00:02.140")).toBe(2140);
    expect(parseTime("01:01.000")).toBe(61000);
  });
  it("parseTime H:MM:SS.mmm", () => {
    expect(parseTime("1:01:01.500")).toBe(3661500);
    expect(parseTime("0:00:05.050")).toBe(5050);
  });
  it("parseTime handles 1-digit millis padded to 500", () => {
    // "00:05.5" => 500ms (padEnd)
    expect(parseTime("00:05.5")).toBe(5500);
    expect(parseTime("00:05.05")).toBe(5050);
  });
  it("round-trip preserves value (within truncation)", () => {
    const values = [0, 123, 1000, 59999, 60000, 3600000, 86399999];
    for (const ms of values) {
      const formatted = formatTime(ms);
      const parsed = parseTime(formatted);
      expect(parsed).toBe(ms - (ms % 1)); // floor
    }
  });
  it("parseTime returns null on invalid", () => {
    expect(parseTime("invalid")).toBeNull();
    expect(parseTime("99:99.000")).toBeNull(); // seconds >=60
    expect(parseTime("00:60.000")).toBeNull();
    expect(parseTime("1:60:00.000")).toBeNull();
  });
  it("parseTime H:MM:SS without millis", () => {
    expect(parseTime("0:01:02")).toBe(62000);
    expect(parseTime("1:02:03")).toBe(3723000);
  });
});

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("returns Just now for future timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const future = Date.now() + 10000;
    expect(relativeTime(future)).toBe("Just now");
  });
  it("returns seconds ago for <60s (via Intl)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const ts = Date.now() - 30 * 1000;
    const result = relativeTime(ts, "en");
    // Intl.RelativeTimeFormat with numeric:auto may return "30 seconds ago" or "in 30 seconds" negative
    expect(result).toMatch(/second|Just now/i);
  });
  it("returns minutes ago for >60s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const ts = Date.now() - 5 * 60 * 1000;
    const result = relativeTime(ts, "en");
    expect(result).toMatch(/ minute|5m/i);
  });
  it("returns days/weeks handling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const tsDays = Date.now() - 3 * 24 * 3600 * 1000;
    expect(relativeTime(tsDays, "en")).toMatch(/day|3/i);
  });
});

describe("truncateFilename", () => {
  it("returns same if <= maxLen", () => {
    expect(truncateFilename("short.mp4", 24)).toBe("short.mp4");
  });
  it("truncates with ...+ext", () => {
    const long = "a".repeat(30) + ".mp4";
    const truncated = truncateFilename(long, 24);
    expect(truncated.length).toBeLessThanOrEqual(24);
    expect(truncated).toContain("...");
    expect(truncated.endsWith(".mp4")).toBe(true);
  });
  it("handles no extension", () => {
    const long = "a".repeat(30);
    const truncated = truncateFilename(long, 10);
    expect(truncated).toContain("...");
  });
});

describe("formatFileSize", () => {
  it("formats 0", () => expect(formatFileSize(0)).toBe("0 B"));
  it("formats KB", () => expect(formatFileSize(1024)).toBe("1 KB"));
  it("formats MB with decimal", () => {
    const v = formatFileSize(1536);
    expect(v).toBe("1.5 KB");
  });
  it("formats GB", () => {
    const v = formatFileSize(1024 * 1024 * 1024);
    expect(v).toBe("1 GB");
  });
});
