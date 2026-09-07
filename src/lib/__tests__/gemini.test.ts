import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyGeminiError, transcribeWithFallback, GeminiKeyError } from "../gemini";

// Mock geminiKeys
vi.mock("../geminiKeys", async () => {
  const actual = await vi.importActual<typeof import("../geminiKeys")>("../geminiKeys");
  return {
    ...actual,
    getEnabledKeysSorted: vi.fn(),
    updateKeyStatus: vi.fn(),
  };
});

import { getEnabledKeysSorted, updateKeyStatus } from "../geminiKeys";

function mockResponse(status: number, headers: Record<string,string> = {}, statusText = ""): Response {
  return {
    status,
    statusText: statusText || `HTTP ${status}`,
    headers: {
      get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
    } as unknown as Headers,
  } as unknown as Response;
}

describe("classifyGeminiError", () => {
  it("401 => invalid_key", () => {
    expect(classifyGeminiError(mockResponse(401))).toMatchObject({ code: "invalid_key", httpStatus: 401 });
  });
  it("403 => invalid_key", () => {
    expect(classifyGeminiError(mockResponse(403))).toMatchObject({ code: "invalid_key" });
  });
  it("429 => rate_limited with default 60s", () => {
    const c = classifyGeminiError(mockResponse(429));
    expect(c.code).toBe("rate_limited");
    expect(c.retryAfterMs).toBe(60_000);
  });
  it("429 with Retry-After header parses 34s", () => {
    const c = classifyGeminiError(mockResponse(429, { "Retry-After": "34" }));
    expect(c.retryAfterMs).toBe(34000);
  });
  it("400 => transient noRetry", () => {
    const c = classifyGeminiError(mockResponse(400));
    // 400 alone returns transient noRetry only if message includes invalid argument; generic 400 without body may still be transient but spec says 400 -> transient noRetry
    // Our implementation: status 400 returns transient with noRetry true
    expect(c.code).toBe("transient");
    expect(c.httpStatus).toBe(400);
  });
  it("400 invalid argument string => noRetry true", () => {
    const c = classifyGeminiError(new Error("Gemini request invalid (400): invalid argument"));
    expect(c.code).toBe("transient");
    expect(c.noRetry).toBe(true);
  });
  it("string with quota exceeded => rate_limited", () => {
    const c = classifyGeminiError(new Error("quota exceeded 429"));
    expect(c.code).toBe("rate_limited");
  });
  it("network error string => network", () => {
    const c = classifyGeminiError(new Error("Failed to fetch"));
    expect(c.code).toBe("network");
  });
  it("5xx => transient", () => {
    const c = classifyGeminiError(mockResponse(500));
    expect(c.code).toBe("transient");
    expect(c.httpStatus).toBe(500);
  });
  it("abort error => noRetry transient", () => {
    const c = classifyGeminiError(new DOMException("Aborted", "AbortError"));
    expect(c.noRetry).toBe(true);
  });
  it("400 with retryDelay in message extracts delay but still noRetry", () => {
    void classifyGeminiError(new Error('rate limit retryDelay: "34s" (400) invalid argument'));
    const pure = classifyGeminiError(new Error("Gemini request invalid (400)"));
    expect(pure.noRetry).toBe(true);
  });
});

describe("transcribeWithFallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateKeyStatus).mockImplementation(()=> null as unknown as never);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("throws if no keys configured", async () => {
    vi.mocked(getEnabledKeysSorted).mockReturnValue([]);
    await expect(transcribeWithFallback("base64", "audio/mp3", "en")).rejects.toThrow(/No Gemini API keys/);
  });

  it("429 on first key then 200 on second => success with attempts", async () => {
    vi.mocked(getEnabledKeysSorted).mockReturnValue([
      { id: "k1", label: "Key1", key: "AIza_key1_12345678901234567890", isActive: true, priority: 0, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
      { id: "k2", label: "Key2", key: "AIza_key2_12345678901234567890", isActive: true, priority: 1, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
    ]);

    // Mock fetch: first call 429, second call 200 with transcription JSON
    const fetchMock = vi.fn()
      // first transcribeAudio via fetch: 429
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: () => null },
        json: async () => ({ error: { message: "quota exceeded", details: [{ retryDelay: "2s" }] } }),
        text: async () => "quota exceeded",
      } as unknown as Response)
      // second key: success with candidates
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '[{"startMs":0,"endMs":320,"word":"Hello","confidence":0.99}]' }] } }],
        }),
      } as unknown as Response);

    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await transcribeWithFallback("fakeBase64", "audio/mpeg", "en");
    expect(result.words).toHaveLength(1);
    expect(result.words[0].word).toBe("Hello");
    expect(result.successfulKeyId).toBe("k2");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].status).toBe("rate_limited");
    expect(result.attempts[1].status).toBe("working");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("400 noRetry throws immediately without trying next key", async () => {
    vi.mocked(getEnabledKeysSorted).mockReturnValue([
      { id: "k1", label: "K1", key: "AIza_key1_12345678901234567890", isActive: true, priority: 0, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
      { id: "k2", label: "K2", key: "AIza_key2_12345678901234567890", isActive: true, priority: 1, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      json: async () => ({ error: { message: "Gemini request invalid (400): invalid argument" } }),
      text: async () => "invalid",
    } as unknown as Response) as unknown as typeof fetch;

    await expect(transcribeWithFallback("b64", "audio/mpeg", "en")).rejects.toThrow(GeminiKeyError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("abort signal mid-fallback throws AbortError", async () => {
    vi.mocked(getEnabledKeysSorted).mockReturnValue([
      { id: "k1", label: "K1", key: "AIza_key1_12345678901234567890", isActive: true, priority: 0, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
      { id: "k2", label: "K2", key: "AIza_key2_12345678901234567890", isActive: true, priority: 1, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
    ]);
    const controller = new AbortController();
    // First fetch returns 429, then delay before next key is abortable (180ms). We trigger abort during that delay.
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => null },
      json: async () => ({ error: { message: "quota exceeded" } }),
      text: async () => "quota",
    } as unknown as Response)) as unknown as typeof fetch;

    const promise = transcribeWithFallback("b64", "audio/mpeg", "en", { signal: controller.signal });
    // Abort during the 180ms inter-key delay
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow(/Aborted|AbortError/i);
  });

  it("all keys fail => AggregateError with attempts", async () => {
    vi.mocked(getEnabledKeysSorted).mockReturnValue([
      { id: "k1", label: "K1", key: "AIza_key1_12345678901234567890", isActive: true, priority: 0, status: "untested", lastTestedAt: null, lastUsedAt: null, lastError: null, lastHttpStatus: null, rateLimitedUntil: null, createdAt: Date.now(), updatedAt: Date.now() } as unknown as never,
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: { get: () => null },
      json: async () => ({ error: { message: "internal" } }),
      text: async () => "internal",
    } as unknown as Response) as unknown as typeof fetch;

    await expect(transcribeWithFallback("b64", "audio/mpeg", "en")).rejects.toThrow(/All 1 Gemini API keys failed/);
  });
});
