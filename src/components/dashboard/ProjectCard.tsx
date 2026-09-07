"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { relativeTime, truncateFilename } from "@/lib/utils";
import { isValidThumbnailDataUrl, placeholderThumbnail } from "@/lib/thumbnail";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => Promise<void> | void;
  onRename: (id: string, newName: string) => Promise<void> | void;
}

export function ProjectCard({ project, onDelete, onRename }: ProjectCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [isRenamingSaving, setIsRenamingSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = truncateFilename(project.name, 32);
  const timeLabel = relativeTime(project.updatedAt ?? project.createdAt);
  const modeLabel = project.settings.mode === "dynamic" ? "Dynamic" : "Static";
  const langLabel = (project.settings.language || "en").toUpperCase();
  const hasSegments = Array.isArray(project.segments) && project.segments.length > 0;
  // Validate thumbnail before rendering — guards against truncated JPEGs stored in IndexedDB
  // (ERR_INVALID_URL when data:image/jpeg length < 1000, e.g. "/8QAHwAAAQU…0AB//9k=")
  const rawThumbnail = project.thumbnailDataUrl;
  const thumbnail = rawThumbnail && isValidThumbnailDataUrl(rawThumbnail) ? rawThumbnail : null;
  const [thumbError, setThumbError] = useState(false);
  const fallbackSrc = placeholderThumbnail();

  // Reset error when thumbnail changes (e.g., after regeneration)
  useEffect(() => {
    setThumbError(false);
  }, [thumbnail]);

  // Keep draft in sync if external rename happens
  useEffect(() => {
    if (!isRenaming) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync of draft with external prop
      setDraftName(project.name);
    }
  }, [project.name, isRenaming]);

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming) {
      // next tick
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isRenaming]);

  // Close menu on outside click / Esc
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleOpen = () => {
    if (hasSegments) {
      router.push(`/projects/${project.id}`);
    } else {
      router.push(`/projects/${project.id}/processing`);
    }
  };

  const handleRenameStart = () => {
    setMenuOpen(false);
    setDraftName(project.name);
    setIsRenaming(true);
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setDraftName(project.name);
  };

  const renameLockRef = useRef(false);
  const handleRenameSave = async () => {
    if (renameLockRef.current) return;
    renameLockRef.current = true;
    const trimmed = draftName.trim();
    if (!trimmed) {
      handleRenameCancel();
      renameLockRef.current = false;
      return;
    }
    if (trimmed === project.name) {
      setIsRenaming(false);
      renameLockRef.current = false;
      return;
    }
    setIsRenamingSaving(true);
    try {
      await onRename(project.id, trimmed);
      setIsRenaming(false);
    } catch (err) {
      console.error("rename failed", err);
    } finally {
      setIsRenamingSaving(false);
      renameLockRef.current = false;
    }
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await onDelete(project.id);
      setConfirmOpen(false);
    } catch (err) {
      console.error("delete failed", err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* feature-card + product-card-stack: surface-card, hairline, rounded-xl, p-0 overflow-hidden */}
      <div className="group relative flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)] transition-all duration-200 hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-elevated)] hover:-translate-y-[1px]">
        {/* Thumbnail — product-card-stack edge-to-edge, rounded-t-xl, hairline bottom */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-[var(--radius-xl)] border-b border-[var(--hairline)] bg-[var(--surface-strong)]">
          {thumbnail && !thumbError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt={`Thumbnail for ${project.name}`}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              draggable={false}
              onError={() => setThumbError(true)}
            />
          ) : thumbnail && thumbError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fallbackSrc}
              alt={`Thumbnail for ${project.name}`}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-[var(--surface-strong)] text-[var(--muted)]"
              role="img"
              aria-label={`Placeholder thumbnail for ${project.name}`}
            >
              <span className="text-2xl" aria-hidden>
                ✦
              </span>
            </div>
          )}

          {/* Subtle gradient on hover */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        </div>

        {/* Content — feature-card padding 24px (spacing-lg) */}
        <div className="flex flex-1 flex-col gap-3 p-6">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSave();
                      if (e.key === "Escape") handleRenameCancel();
                    }}
                    onBlur={handleRenameSave}
                    disabled={isRenamingSaving}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--primary)] bg-[var(--surface-card)] px-3 py-2 text-[15px] font-[500] leading-none text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    aria-label="Rename project"
                    maxLength={40}
                  />
                  {isRenamingSaving && (
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--hairline)] border-t-[var(--primary)]" aria-hidden />
                  )}
                </div>
              ) : (
                <>
                  <h2
                    title={project.name}
                    className="truncate text-[20px] font-[500] leading-[1.35] tracking-[0] text-[var(--ink)]"
                    style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}
                  >
                    {displayName}
                  </h2>
                  <p className="mt-1 text-[14px] font-[400] leading-[1.5] tracking-[0] text-[var(--muted)]">{timeLabel}</p>
                </>
              )}
            </div>

            {/* Overflow menu — button-outline circle 40px */}
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                aria-label={`Project options for ${project.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] hover:border-[var(--hairline-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
              >
                <span aria-hidden className="text-[18px] leading-none">
                  ⋮
                </span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-20 min-w-[160px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface-card)] py-1 shadow-[var(--shadow-elevated)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleRenameStart}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] font-[400] text-[var(--body)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                  >
                    <span aria-hidden className="text-xs">
                      ✎
                    </span>{" "}
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] font-[400] text-[var(--semantic-error)] transition-colors hover:bg-[rgba(220,38,38,0.06)]"
                  >
                    <span aria-hidden className="text-xs">
                      ⌫
                    </span>{" "}
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: badge-pill + button-primary */}
          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--surface-strong)] px-[10px] py-[4px] text-[12px] font-[600] uppercase leading-[1.4] tracking-[0.96px] text-[var(--ink)]">
              {modeLabel} · {langLabel}
            </span>

            <button
              type="button"
              onClick={handleOpen}
              aria-label={`Open project ${project.name}`}
              className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] leading-none text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] transition hover:bg-[var(--primary-active)] hover:shadow-[0_4px_16px_rgba(12,10,9,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] active:scale-[0.98]"
            >
              Open
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirm dialog — light editorial */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-[rgba(12,10,9,0.28)] backdrop-blur-[12px]"
            onClick={() => !isDeleting && setConfirmOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="relative w-full max-w-[380px] rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-elevated)]"
          >
            <h3 id="delete-title" className="text-[16px] font-[500] leading-[1.5] tracking-[0.16px] text-[var(--ink)]">
              Delete project?
            </h3>
            <p className="mt-2 text-[14px] font-[400] leading-[1.5] text-[var(--body)]">
              &ldquo;{truncateFilename(project.name, 28)}&rdquo; will be permanently deleted. This cannot be undone.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-transparent px-5 text-[15px] font-[500] leading-none text-[var(--ink)] transition hover:bg-[var(--surface-strong)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--semantic-error)] px-5 text-[15px] font-[500] leading-none text-[var(--on-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition hover:brightness-[0.92] disabled:opacity-50"
              >
                {isDeleting && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
