"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { ProjectGrid } from "@/components/dashboard/ProjectGrid";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Toast } from "@/components/ui/Toast";
import { setPendingFile } from "@/store/pendingUpload";
import { isValidVideoFile } from "@/lib/utils";

export default function HomePage() {
  const { projects, loading, error, retry, deleteProject, renameProject } = useProjects();

  const [toast, setToast] = useState<{ message: string; variant: "default" | "error" } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, variant: "default" | "error" = "default") => {
    setToast({ message, variant });
  }, []);

  const handleNewProjectClick = useCallback(() => {
    // Single source of truth: delegate to SiteHeader's file input via event (UI-3)
    // Keeps one pendingFile singleton — avoids double modal race
    if (typeof window !== "undefined") {
      const headerInput = document.getElementById("capai-header-file-input") as HTMLInputElement | null;
      if (headerInput) {
        headerInput.click();
        return;
      }
      window.dispatchEvent(new CustomEvent("capai:request-new-project", { detail: { source: "capai-internal", token: "capai-v1" } }));
      // Fallback to local input if header input not mounted (e.g., SSR)
      window.setTimeout(() => fileInputRef.current?.click(), 50);
      return;
    }
    fileInputRef.current?.click();
  }, []);

  // Bridge global header's "+ New Project" → dashboard file input
  useEffect(() => {
    const onRequest = () => fileInputRef.current?.click();
    const onToast = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string; variant?: "default" | "error" }>;
      const msg = ce.detail?.message;
      if (msg) showToast(msg, ce.detail?.variant ?? "error");
    };
    window.addEventListener("capai:request-new-project", onRequest);
    window.addEventListener("capai:toast", onToast as EventListener);
    return () => {
      window.removeEventListener("capai:request-new-project", onRequest);
      window.removeEventListener("capai:toast", onToast as EventListener);
    };
  }, [showToast]);

  const handleValidFile = useCallback(
    (file: File) => {
      setPendingFile(file);
      // The Quick Settings modal (owned by Upload agent) listens for this event.
      // For now, also show a subtle confirmation toast that the file was captured.
      // We avoid a success toast to keep the flow clean — modal will appear.
      // If no modal listener, at least the file is stored in the singleton.
    },
    []
  );

  const validateAndHandleFile = useCallback(
    (file: File) => {
      if (!isValidVideoFile(file)) {
        showToast("Unsupported format. Please use MP4, MOV, WebM, MKV or AVI.", "error");
        return;
      }
      handleValidFile(file);
    },
    [handleValidFile, showToast]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset input so same file can be selected again
      e.target.value = "";
      if (!file) return;
      validateAndHandleFile(file);
    },
    [validateAndHandleFile]
  );

  // Drag & drop handlers — entire dashboard is a drop target
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep glow visible while dragging
    if (!isDragOver) setIsDragOver(true);
    // Indicate copy
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, [isDragOver]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      // Only handle first file; if multiple, pick first video
      const fileList = Array.from(files);
      const videoFile = fileList.find((f) => isValidVideoFile(f)) ?? fileList[0];
      if (!videoFile) return;

      if (!isValidVideoFile(videoFile)) {
        showToast("Unsupported format. Please use MP4, MOV, WebM, MKV or AVI.", "error");
        return;
      }
      handleValidFile(videoFile);
    },
    [handleValidFile, showToast]
  );

  return (
    <div
      className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)]"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input — accessible via label association, sr-only not display:none (WCAG 2.1.1) */}
      <label htmlFor="capai-file-input" className="sr-only">
        Upload video file
      </label>
      <input
        ref={fileInputRef}
        id="capai-file-input"
        name="videoFile"
        type="file"
        accept=".mp4,.mov,.webm,.mkv,.avi,video/*"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {/* Single global header is in layout — no duplicate here. Dashboard actions live in SiteHeader. */}

      {/* Drag overlay — editorial light: hairline border + rgba(255,255,255,0.6) backdrop-blur + subtle mint/peach orbs */}
      {isDragOver && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30 overflow-hidden border border-[var(--hairline)] bg-[rgba(255,255,255,0.6)] backdrop-blur-[12px]"
        >
          {/* Atmospheric mint orb */}
          <div
            className="absolute -right-32 -top-32 h-[560px] w-[560px] rounded-full opacity-40"
            style={{
              background: "radial-gradient(circle at center, var(--gradient-mint) 0%, transparent 70%)",
            }}
          />
          {/* Atmospheric peach orb */}
          <div
            className="absolute -bottom-40 -left-40 h-[640px] w-[640px] rounded-full opacity-35"
            style={{
              background: "radial-gradient(circle at center, var(--gradient-peach) 0%, transparent 70%)",
            }}
          />
          {/* Soft lavender wash for depth */}
          <div
            className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
            style={{
              background: "radial-gradient(circle at center, var(--gradient-lavender) 0%, transparent 72%)",
            }}
          />

          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] px-8 py-6 shadow-[var(--shadow-elevated)]">
              <p className="flex items-center justify-center gap-3 text-[15px] font-[500] leading-none text-[var(--ink)]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--on-primary)] text-sm leading-none">
                  ↓
                </span>
                Drop video to create project
              </p>
              <p className="mt-2 text-center text-[14px] font-[400] leading-[1.5] text-[var(--muted)]">MP4 · MOV · WebM · MKV · AVI</p>
            </div>
          </div>
        </div>
      )}

      {/* Main content — 12-col editorial: max-w 1200 centered, gap 24px lg */}
      <main id="main-content" className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]"
              >
                <div className="aspect-video rounded-t-[var(--radius-xl)] border-b border-[var(--hairline)] bg-[var(--surface-strong)]" />
                <div className="space-y-3 p-6">
                  <div className="h-5 w-3/5 rounded bg-[var(--surface-strong)]" />
                  <div className="h-3 w-2/5 rounded bg-[var(--surface-strong)]" />
                  <div className="flex items-center justify-between pt-2">
                    <div className="h-[22px] w-24 rounded-[var(--radius-pill)] bg-[var(--surface-strong)]" />
                    <div className="h-10 w-20 rounded-[var(--radius-pill)] bg-[var(--surface-strong)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-[rgba(220,38,38,0.18)] bg-[var(--surface-card)] p-10 text-center shadow-[var(--shadow-soft)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(220,38,38,0.08)] text-[var(--semantic-error)]">!</div>
            <h2 className="text-[16px] font-semibold text-[var(--ink)]">Couldn&apos;t load projects</h2>
            <p className="max-w-sm text-sm text-[var(--body)] break-words">{error}</p>
            <button type="button" onClick={retry} className="mt-2 inline-flex h-10 items-center justify-center rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)]">Retry</button>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onNewProject={handleNewProjectClick} />
        ) : (
          <>
            {/* Section header — caption-uppercase muted #6e6862 via var(--muted) */}
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h1 className="flex items-baseline gap-2 text-[12px] font-[600] uppercase leading-[1.4] tracking-[0.96px] text-[var(--muted)]">
                Projects
                <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--surface-strong)] px-2 py-0.5 text-[12px] font-[600] leading-none tracking-[0.08em] text-[var(--muted)]">
                  {projects.length}
                </span>
              </h1>
              <span className="hidden text-[14px] font-[400] leading-[1.5] text-[var(--muted)] sm:inline">Tip: drop a video anywhere</span>
            </div>
            <ProjectGrid projects={projects} onDelete={deleteProject} onRename={renameProject} />
          </>
        )}
      </main>

      {/* Footer — hairline-soft, muted text #6e6862 via var(--muted) */}
      <footer className="border-t border-[var(--hairline-soft)] bg-[var(--canvas)] px-6 py-4 text-center text-[12px] font-[400] leading-[1.5] tracking-[0.15px] text-[var(--muted)]">
        CapAI · Local-first · No upload
      </footer>

      {/* Toast */}
      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}

      {/* Drag pulse keyframes — scoped to page */}
      <style>{`@keyframes capai-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.85; } }`}</style>
    </div>
  );
}
