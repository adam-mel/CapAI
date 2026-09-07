import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";

// Mock URL.createObjectURL / revoke for jsdom
if (typeof URL.createObjectURL === "undefined") {
  (URL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL = vi.fn(() => "blob:fake-url") as unknown as typeof URL.createObjectURL;
}
if (typeof URL.revokeObjectURL === "undefined") {
  (URL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL }).revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
}

// Polyfill crypto.randomUUID for jsdom if missing
if (typeof crypto !== "undefined" && !("randomUUID" in crypto)) {
  (crypto as unknown as { randomUUID: () => string }).randomUUID = () => `test-${Math.random().toString(36).slice(2, 10)}`;
}

// Suppress console.debug in tests unless explicitly needed (keep warnings)
const origDebug = console.debug;
console.debug = (...args: unknown[]) => {
  if (process.env.VITEST_DEBUG) origDebug(...args);
};
