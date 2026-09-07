import { describe, it, expect } from "vitest";
import {
  generateASS,
  formatAssTime,
  hexToAssColour,
  escapeAssText,
} from "../assGenerator";
import type { CaptionSegment, CaptionStyle } from "../types";

// Helper: minimal style
function makeStyle(overrides: Partial<CaptionStyle> = {}): CaptionStyle {
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
    strokeWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    pillEnabled: false,
    pillColor: "#000000",
    pillOpacity: 0.75,
    pillPaddingX: 8,
    pillPaddingY: 4,
    pillRadius: 8,
    highlightStyle: "karaoke",
    activeWordColor: "#FFD700",
    inactiveWordColor: "#FFFFFF",
    positionPreset: "bottom",
    positionOffsetY: 0,
    hAlign: "center",
    ...overrides,
  };
}

function makeSegments(count: number, startGap = 80): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const wordsPer = 2 + (i % 3);
    const words = [];
    for (let w = 0; w < wordsPer; w++) {
      const s = t + w * 220;
      const e = s + 200;
      words.push({ word: `word${i}_${w}`, startMs: s, endMs: e, confidence: 0.9 });
    }
    const segStart = t;
    const segEnd = words[words.length - 1].endMs;
    segs.push({
      id: `seg-${i}`,
      startMs: segStart,
      endMs: segEnd,
      text: words.map((x) => x.word).join(" "),
      words,
    });
    t = segEnd + startGap;
  }
  return segs;
}

describe("formatAssTime", () => {
  it("formats 0 -> 0:00:00.00", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
  });
  it("formats 3600000 (1h) -> 1:00:00.00", () => {
    expect(formatAssTime(3600000)).toBe("1:00:00.00");
  });
  it("formats 86399000 (23:59:59) -> 23:59:59.00", () => {
    expect(formatAssTime(86399000)).toBe("23:59:59.00");
  });
  it("clamps negative to 0:00:00.00", () => {
    expect(formatAssTime(-100)).toBe("0:00:00.00");
    expect(formatAssTime(-9999)).toBe("0:00:00.00");
  });
  it("handles centisecond rounding: 15ms -> 0:00:00.01", () => {
    expect(formatAssTime(15)).toBe("0:00:00.01");
  });
  it("handles 59999ms -> 0:00:59.99", () => {
    expect(formatAssTime(59999)).toBe("0:00:59.99");
  });
});

describe("hexToAssColour", () => {
  it("converts #FFFFFF to ASS white opaque", () => {
    expect(hexToAssColour("#FFFFFF")).toBe("&H00FFFFFF");
  });
  it("converts #FF0000 to &H000000FF (ABGR)", () => {
    // hex FF0000 => R FF, G 00, B 00 => ASS &H00 00 00 FF
    expect(hexToAssColour("#FF0000")).toBe("&H000000FF");
  });
  it("handles opacity override 0.5", () => {
    // 0.5 opacity => alpha = (1-0.5)*255=127.5→128 => 0x80
    const c = hexToAssColour("#FFFFFF", 0.5);
    expect(c).toMatch(/^&H80/);
  });
  it("handles #RRGGBBAA with alpha", () => {
    // #FFFFFF80 => alpha hex 80 => 128, inverted 127 => 0x7F ?
    // implementation: alpha = 255 - hexAlpha (128) =127 => 0x7F
    expect(hexToAssColour("#FFFFFF80")).toBe("&H7FFFFFFF");
  });
  it("fallback on invalid", () => {
    expect(hexToAssColour("not a color")).toBe("&H00FFFFFF");
    expect(hexToAssColour(null)).toBe("&H00FFFFFF");
  });
});

describe("escapeAssText", () => {
  it("escapes braces and backslashes", () => {
    expect(escapeAssText("hello {world} \\")).toBe("hello \\{world\\} \\\\");
  });
  it("converts newlines to \\N", () => {
    expect(escapeAssText("a\nb")).toBe("a\\Nb");
  });
});

describe("generateASS — validation and PlayRes", () => {
  it("throws if video dimensions missing", () => {
    const segs = makeSegments(1);
    expect(() => generateASS(segs, makeStyle(), undefined, undefined)).toThrow(/Missing video dimensions/);
  });
  it("throws if dimensions <320 or <240", () => {
    const segs = makeSegments(1);
    expect(() => generateASS(segs, makeStyle(), 319, 240)).toThrow();
    expect(() => generateASS(segs, makeStyle(), 320, 239)).toThrow();
    expect(() => generateASS(segs, makeStyle(), 0, 0)).toThrow();
  });
  it("accepts 320x240 minimal valid", () => {
    const segs = makeSegments(1);
    expect(() => generateASS(segs, makeStyle(), 320, 240)).not.toThrow();
  });
  it("emits correct PlayRes header for 1080x1920", () => {
    const ass = generateASS(makeSegments(1), makeStyle(), 1080, 1920, "static");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
  });
  it("emits PlayRes for 1280x720", () => {
    const ass = generateASS(makeSegments(1), makeStyle(), 1280, 720, "static");
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("PlayResY: 720");
  });
});

describe("generateASS — WYSIWYG clamp 10-400", () => {
  it("clamps too small fontSize to 10 via uniform scale", () => {
    // With 1080x1920, scale = min(1080/352=3.06, 1920/720=2.66)=2.66
    // raw = 2 *2.66=5.33 => clamp to 10
    const style = makeStyle({ fontSize: 2 });
    const ass = generateASS(makeSegments(1), style, 1080, 1920, "static");
    const m = ass.match(/Style: Default,[^,]+,(\d+),/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(10);
  });
  it("clamps huge fontSize to 400", () => {
    const style = makeStyle({ fontSize: 400 });
    const ass = generateASS(makeSegments(1), style, 1080, 1920, "static");
    const m = ass.match(/Style: Default,[^,]+,(\d+),/);
    expect(Number(m![1])).toBe(400);
  });
  it("scales 48 at 352x720 stays 48 (ref size 1:1)", () => {
    const style = makeStyle({ fontSize: 48 });
    const ass = generateASS(makeSegments(1), style, 352, 720, "static");
    const m = ass.match(/Style: Default,[^,]+,(\d+),/);
    expect(Number(m![1])).toBe(48);
  });
  it("scales Bold 60 at 1080x1920 to ~160 (uniform min scale 2.66)", () => {
    const style = makeStyle({ fontSize: 60, fontFamily: "Impact", fontWeight: 900 });
    const ass = generateASS(makeSegments(1), style, 1080, 1920, "static");
    const m = ass.match(/Style: Default,[^,]+,(\d+),/);
    // 60 * 2.666 = 160
    expect(Number(m![1])).toBe(160);
  });
  it("scales at 1280x720 uses 720 ref height limit", () => {
    // 1280/352=3.63, 720/720=1 => min 1 => 60*1=60
    const style = makeStyle({ fontSize: 60 });
    const ass = generateASS(makeSegments(1), style, 1280, 720, "static");
    const m = ass.match(/Style: Default,[^,]+,(\d+),/);
    expect(Number(m![1])).toBe(60);
  });
  it("fallback font Impact -> Arial Black", () => {
    const style = makeStyle({ fontFamily: "Impact", fontSize: 48 });
    const ass = generateASS(makeSegments(1), style, 640, 480, "static");
    expect(ass).toContain("Arial Black");
    expect(ass).not.toMatch(/Style: Default,Impact,/);
  });
  it("Bebas Neue -> Arial, Anton -> Arial", () => {
    expect(generateASS(makeSegments(1), makeStyle({ fontFamily: "Bebas Neue" }), 640, 480, "static")).toContain(",Arial,");
    expect(generateASS(makeSegments(1), makeStyle({ fontFamily: "Anton" }), 640, 480, "static")).toContain(",Arial,");
  });
  it("Montserrat stays Montserrat (no fallback)", () => {
    const ass = generateASS(makeSegments(1), makeStyle({ fontFamily: "Montserrat" }), 640, 480, "static");
    expect(ass).toContain(",Montserrat,");
  });
});

describe("generateASS — dialogue count and modes", () => {
  it("static mode: 7 segments => 7 Dialogue lines", () => {
    const ass = generateASS(makeSegments(7), makeStyle(), 1280, 720, "static");
    const count = (ass.match(/^Dialogue:/gm) || []).length;
    expect(count).toBe(7);
  });
  it("static: 75 segments => 75 Dialogue lines", () => {
    const ass = generateASS(makeSegments(75), makeStyle(), 1280, 720, "static");
    const count = (ass.match(/^Dialogue:/gm) || []).length;
    expect(count).toBe(75);
  });
  it("dynamic mode: highlights each word interval, count > segments", () => {
    // Each segment with ~2-4 words => dynamic expands to words count + gap lines
    const segs = makeSegments(7);
    const ass = generateASS(segs, makeStyle(), 1280, 720, "dynamic");
    const count = (ass.match(/^Dialogue:/gm) || []).length;
    // At least 7, typically ~ sum words (approx 7 * avg 3 =21) plus gaps
    expect(count).toBeGreaterThan(7);
    expect(count).toBeLessThan(100);
  });
  it("dynamic with gap >150ms produces gold-pop gap line", () => {
    // Create segment where firstWordStart - segStart >150
    const seg: CaptionSegment = {
      id: "s1",
      startMs: 0,
      endMs: 2000,
      text: "hello world",
      words: [
        { word: "hello", startMs: 500, endMs: 700, confidence: 0.9 },
        { word: "world", startMs: 800, endMs: 1000, confidence: 0.9 },
      ],
    };
    const style = makeStyle({ highlightStyle: "pop", activeWordColor: "#FFD700" });
    const ass = generateASS([seg], style, 1280, 720, "dynamic");
    // Gap 500ms => should emit a gap Dialogue line before word highlights
    const lines = ass.split("\r\n").filter((l) => l.startsWith("Dialogue:"));
    // First dialogue should be the gap (0 to 500)
    expect(lines[0]).toContain("0:00:00.00");
    expect(lines[0]).toContain("0:00:00.50");
    // Gap line should highlight first word gold (activeAss) with \b1
    expect(lines[0]).toMatch(/\\c&H/);
    expect(lines[0]).toContain("hello");
  });
  it("gap exactly 80ms (old threshold) now NOT emitted with 150ms threshold", () => {
    const seg: CaptionSegment = {
      id: "s1",
      startMs: 0,
      endMs: 1000,
      text: "hello world",
      words: [
        { word: "hello", startMs: 80, endMs: 280, confidence: 0.9 },
        { word: "world", startMs: 300, endMs: 500, confidence: 0.9 },
      ],
    };
    const ass = generateASS([seg], makeStyle(), 1280, 720, "dynamic");
    const lines = ass.split("\r\n").filter((l) => l.startsWith("Dialogue:"));
    // With 150ms threshold, gap 80 not emitted, so first line starts at 80ms (hello highlight)
    // Previous buggy 80ms would have emitted gap at 0-80.
    expect(lines[0]).not.toContain("0:00:00.00,0:00:00.08");
    expect(lines[0]).toContain("0:00:00.08");
  });
  it("gap >150 emits inactive gap with gold first word (new behavior)", () => {
    const seg: CaptionSegment = {
      id: "s1",
      startMs: 0,
      endMs: 1000,
      text: "hello world",
      words: [
        { word: "hello", startMs: 200, endMs: 400, confidence: 0.9 },
        { word: "world", startMs: 500, endMs: 700, confidence: 0.9 },
      ],
    };
    const ass = generateASS([seg], makeStyle(), 1280, 720, "dynamic");
    const lines = ass.split("\r\n").filter((l) => l.startsWith("Dialogue:"));
    expect(lines[0]).toBe("Dialogue: 0,0:00:00.00,0:00:00.20,Default,,0,0,0,,{\\c&H0000D7FF&\\b1}hello{\\r} {\\c&H00FFFFFF&}world{\\r}");
  });
  it("empty segments returns header only, 0 Dialogue", () => {
    const ass = generateASS([], makeStyle(), 640, 480, "static");
    expect(ass).toContain("[Script Info]");
    expect(ass).not.toContain("Dialogue:");
  });
  it("skips empty text and no words", () => {
    const segs: CaptionSegment[] = [{ id: "x", startMs: 0, endMs: 500, text: "   ", words: [] }];
    const ass = generateASS(segs, makeStyle(), 640, 480, "static");
    expect((ass.match(/^Dialogue:/gm) || []).length).toBe(0);
  });
});

describe("generateASS — custom ranges and shadow/stroke scaling", () => {
  const getStyleField = (ass: string, field: "fontsize" | "outline" | "shadow" | "marginV" | "borderStyle") => {
    const line = ass.split("\r\n").find((l) => l.startsWith("Style: "))!;
    const parts = line.replace("Style: ", "").split(",");
    // indices per header: 0 Default,1 Font,2 Size,3 Primary,4 Secondary,5 OutlineColour,6 Back,7 Bold,8 Italic,9 Underline,10 Strike,11 ScaleX,12 ScaleY,13 Spacing,14 Angle,15 BorderStyle,16 Outline,17 Shadow,18 Align,19 L,20 R,21 V,22 Enc
    const idx: Record<string, number> = { fontsize: 2, borderStyle: 15, outline: 16, shadow: 17, marginV: 21 };
    return Number(parts[idx[field]]);
  };
  it("positionOffsetY -50 vs +50 changes MarginV inversely for bottom preset", () => {
    const styleNeg = makeStyle({ positionPreset: "bottom", positionOffsetY: -50 });
    const stylePos = makeStyle({ positionPreset: "bottom", positionOffsetY: 50 });
    const assNeg = generateASS(makeSegments(1), styleNeg, 1280, 720, "static");
    const assPos = generateASS(makeSegments(1), stylePos, 1280, 720, "static");
    const mNeg = getStyleField(assNeg, "marginV");
    const mPos = getStyleField(assPos, "marginV");
    // bottom: marginV = base - offsetScaled, so -50 gives larger marginV than +50
    expect(mNeg).toBeGreaterThan(mPos);
  });
  it("shadow integer scaled by wysiwyg: 352 vs 1080 difference", () => {
    const style = makeStyle({ shadowBlur: 4 });
    const assSmall = generateASS(makeSegments(1), style, 352, 720, "static");
    const assLarge = generateASS(makeSegments(1), style, 1080, 1920, "static");
    // small=1, large=min(3.06,2.66)=2.66 => round 3
    expect(getStyleField(assSmall, "shadow")).toBe(1);
    expect(getStyleField(assLarge, "shadow")).toBe(3);
  });
  it("strokeWidth scaled via outline field", () => {
    const style = makeStyle({ strokeWidth: 2 });
    const ass = generateASS(makeSegments(1), style, 1280, 720, "static");
    expect(getStyleField(ass, "outline")).toBe(2); // at 1280x720 scale 1
    const assLarge = generateASS(makeSegments(1), style, 1080, 1920, "static");
    expect(getStyleField(assLarge, "outline")).toBeGreaterThan(2); // scaled
  });
  it("pillEnabled changes BackColour opacity and BorderStyle", () => {
    const off = generateASS(makeSegments(1), makeStyle({ pillEnabled: false, pillColor: "#000000", pillOpacity: 0.5 }), 640, 480, "static");
    const on = generateASS(makeSegments(1), makeStyle({ pillEnabled: true, pillColor: "#FF0000", pillOpacity: 0.5 }), 640, 480, "static");
    // BackColour is 4th colour field, BorderStyle is after angle
    // For pill disabled, BackColour has opacity 0 => &HFF... ; enabled with 0.5 => &H80...
    expect(off).not.toBe(on);
    expect(on).toContain(",3,"); // BorderStyle 3 when pill
    expect(off).toContain(",1,"); // BorderStyle 1 when not pill
  });
  it("textTransform uppercase applied to Dialogue", () => {
    const seg: CaptionSegment = { id: "a", startMs: 0, endMs: 500, text: "hello world", words: [] };
    const ass = generateASS([seg], makeStyle({ textTransform: "uppercase" }), 640, 480, "static");
    expect(ass).toContain("HELLO WORLD");
  });
  it("formatAssTime boundaries: durationMs not used but ensure large ms not clipped", () => {
    const seg: CaptionSegment = { id: "a", startMs: 86399000, endMs: 86400000, text: "end", words: [] };
    const ass = generateASS([seg], makeStyle(), 640, 480, "static");
    expect(ass).toContain("23:59:59.00");
    expect(ass).toContain("24:00:00.00");
  });
});
