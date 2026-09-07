/**
 * CapAI — Pending upload singleton
 * PRD §4.1 — bridges dashboard drop/file-input to Quick Settings modal (upload agent).
 * Stores the pending File in-memory and dispatches `capai:open-quick-settings`.
 * The upload agent listens for this event to open the modal.
 */

let pendingFile: File | null = null;

export function setPendingFile(file: File): void {
  pendingFile = file;
  if (typeof window !== "undefined") {
    // Notify listeners (upload agent) — detail contains file reference
    // BUG-AUTH-8: include internal token so QuickSettingsModal can validate origin and block spoofed events
    window.dispatchEvent(
      new CustomEvent("capai:open-quick-settings", {
        detail: { file, name: file.name, size: file.size, type: file.type, source: "capai-internal", token: "capai-v1" },
      })
    );
    try {
      // Lightweight persistence hint for debugging — actual File stays in memory
      sessionStorage.setItem("capai:pending-file-name", file.name);
      sessionStorage.setItem("capai:pending-file-type", file.type);
      sessionStorage.setItem("capai:pending-file-size", String(file.size));
    } catch {
      // sessionStorage unavailable (e.g. private mode) — ignore
    }
  }
}

export function getPendingFile(): File | null {
  return pendingFile;
}

export function clearPendingFile(): void {
  pendingFile = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("capai:pending-file-name");
      sessionStorage.removeItem("capai:pending-file-type");
      sessionStorage.removeItem("capai:pending-file-size");
    } catch {
      // ignore
    }
  }
}

export function hasPendingFile(): boolean {
  return pendingFile !== null;
}
