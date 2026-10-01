"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { setPendingFile } from "@/store/pendingUpload";
import { isValidVideoFile } from "@/lib/utils";

/**
 * SiteHeader — single global top-nav per ElevenLabs spec
 * 64px, canvas bg, hairline, ink text
 * Layout: wordmark left (✦ CapAI 20/500), tagline center (hide mobile), primary pill right
 * The primary pill is `+ New Project` — header owns a hidden file input so it works from any route
 * (dashboard, editor, processing). It also dispatches `capai:request-new-project` for the dashboard's
 * legacy file input and shows a toast on invalid file via `capai:toast`.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewProjectClick = useCallback(() => {
    // Prefer the header's own hidden input (works from any route, triggers QuickSettingsModal)
    // Also dispatch request event so the dashboard's input (if mounted) can handle as fallback.
    // If user is not on dashboard, we still open the file picker right away — no navigation needed.
    const headerInput = fileInputRef.current;
    const dashboardInput = typeof document !== "undefined" ? (document.getElementById("capai-file-input") as HTMLInputElement | null) : null;

    // Dispatch for dashboard listener — dashboard will click its own input
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("capai:request-new-project", { detail: { source: "capai-internal", token: "capai-v1" } }));
    }

    // If dashboard input exists and we're on /, let it handle (avoid double picker)
    // Heuristic: if on "/" and dashboard input exists, don't also open header picker
    const isDashboard = pathname === "/";
    if (isDashboard && dashboardInput) {
      // Dashboard's useEffect will click its input in response to the event.
      // As fallback, click directly after a tick if not already opened.
      window.setTimeout(() => {
        // Only open header picker if dashboard picker didn't already trigger modal (no pending file yet)
        // We cannot reliably detect, so we avoid double-open by not auto-clicking header on dashboard
      }, 0);
      // Also try direct click as immediate fallback (some browsers block double)
      // We prefer dashboard input; header input is fallback for non-dashboard routes
      return;
    }

    // On non-dashboard routes, open header's picker directly
    if (headerInput) {
      headerInput.click();
      return;
    }

    // Last fallback: try dashboard input even if not on dashboard (may still exist in DOM via persistence?)
    if (dashboardInput) {
      dashboardInput.click();
      return;
    }

    // No input found and not on dashboard — navigate home then request
    if (pathname !== "/") {
      router.push("/");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("capai:request-new-project", { detail: { source: "capai-internal", token: "capai-v1" } }));
        const el = document.getElementById("capai-file-input") as HTMLInputElement | null;
        if (el) el.click();
        else if (fileInputRef.current) fileInputRef.current.click();
      }, 420);
    }
  }, [pathname, router]);

  const handleHeaderFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isValidVideoFile(file)) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("capai:toast", {
            detail: { message: "Unsupported format. Please use MP4, MOV, WebM, MKV or AVI.", variant: "error" },
          })
        );
      }
      return;
    }
    setPendingFile(file);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--canvas)] px-4 sm:px-6">
        {/* Left: wordmark */}
        <div className="flex items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-2" aria-label="CapAI home">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[13px] leading-none text-[var(--ink)]"
              aria-hidden
            >
              ✦
            </span>
            <span
              className="text-[20px] font-[500] tracking-tight text-[var(--ink)]"
              style={{ fontFamily: "var(--font-eb), 'EB Garamond', 'Times New Roman', serif" }}
            >
              CapAI
            </span>
          </Link>
          <span className="hidden items-center gap-2 sm:inline-flex">
            <span className="h-3 w-px bg-[var(--hairline)]" aria-hidden />
            <span className="text-[12px] font-[600] uppercase leading-[1.4] tracking-[0.96px] text-[var(--muted)]">AI Captions, Burned In.</span>
          </span>
        </div>

        {/* Center: nav reserved — remove empty landmark (UI-26) */}
        {/* Empty nav landmark removed to avoid confusion; center slot kept visually via tagline only */}

        {/* Right: settings gear + primary pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Open settings"
            onClick={() => {
              // BUG-AUTH-8: include internal token so SettingsWindow can validate origin and block spoofed CustomEvents
              if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("capai:open-settings", { detail: { source: "capai-internal", token: "capai-v1" } }));
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hairline-soft)] bg-[var(--surface-card)] text-[var(--ink)] transition hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
          >
            <span aria-hidden className="text-[16px] leading-none">
              ⚙
            </span>
          </button>
          <button
            type="button"
            onClick={handleNewProjectClick}
            aria-label="Create new project"
            className="inline-flex h-10 items-center justify-center rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] leading-none text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] transition hover:bg-[var(--primary-active)] hover:shadow-[0_4px_16px_rgba(12,10,9,0.10)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
          >
            + New Project
          </button>
        </div>
      </header>
      {/* Hidden file input owned by header — works from editor/processing too; sr-only not display:none so AT can discover label (UI-2) */}
      <label htmlFor="capai-header-file-input" className="sr-only">Upload video file</label>
      <input
        ref={fileInputRef}
        id="capai-header-file-input"
        name="headerVideoFile"
        type="file"
        accept=".mp4,.mov,.webm,.mkv,.avi,video/*"
        className="sr-only"
        onChange={handleHeaderFileChange}
      />
    </>
  );
}
