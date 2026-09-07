/**
 * CapAI — Parse & Group Transcription
 * PRD §11.3 — Groups WordTokens into CaptionSegments of N words.
 */

import type { CaptionSegment, WordToken } from "./types";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

/**
 * Group word tokens into caption segments.
 * Each segment takes `wordsPerSegment` consecutive words (last chunk may be shorter).
 * startMs = first word's startMs, endMs = last word's endMs
 * text = words joined with spaces
 * confidence = minimum word confidence in the segment (if any word has confidence)
 */
export function groupWordsIntoSegments(
  words: WordToken[],
  wordsPerSegment: number
): CaptionSegment[] {
  if (!words || words.length === 0) return [];

  const rawPer = Math.floor(Number(wordsPerSegment));
  const per = Number.isFinite(rawPer) ? Math.max(1, Math.min(5, rawPer)) : 3;
  const segments: CaptionSegment[] = [];

  for (let i = 0; i < words.length; i += per) {
    const chunk = words.slice(i, i + per);
    if (chunk.length === 0) continue;

    const startMs = chunk[0].startMs;
    const endMs = chunk[chunk.length - 1].endMs;
    const text = chunk.map((w) => w.word).join(" ");

    // confidence = min across chunk where defined
    const confidences = chunk
      .map((w) => w.confidence)
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
    const confidence = confidences.length > 0 ? Math.min(...confidences) : undefined;

    segments.push({
      id: genId(),
      startMs,
      endMs,
      text,
      words: chunk.map((w) => ({ ...w })),
      confidence,
    });
  }

  return segments;
}

/**
 * Convenience: strip and parse any markdown-wrapped JSON array string.
 * Useful for LLM responses that wrap JSON in ```json ... ```
 */
export function extractJsonArray(text: string): unknown {
  let t = text.trim();

  // Remove markdown code fences if present
  if (t.includes("```")) {
    // Prefer content between first ``` and last ```
    const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) t = fenceMatch[1].trim();
  }

  // If still wrapped, try to find outermost [ ... ]
  const firstBracket = t.indexOf("[");
  const lastBracket = t.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    t = t.slice(firstBracket, lastBracket + 1);
  }

  return JSON.parse(t);
}
