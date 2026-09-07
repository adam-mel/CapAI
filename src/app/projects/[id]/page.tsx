"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import type { Project } from "@/lib/types";
import { EditorProvider } from "@/context/EditorContext";
import EditorShell from "@/components/editor/EditorShell";

/**
 * CapAI — Project Editor Page
 * Loads project from Dexie and renders the full Editor.
 * EditorShell composes VideoPlayer, CaptionList, StylePanel and Waveform.
 */
export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await db.projects.get(id);
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (!p.segments || p.segments.length === 0) {
          router.replace(`/projects/${id}/processing`);
          return;
        }
        setProject(p);
        setLoadError(null);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (loading && !notFound && !loadError) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)]">
        {/* Secondary status bar — 48px, no duplicate CapAI (global header owns it) */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--hairline)] bg-[var(--canvas)] px-4 sm:px-6 text-sm text-[var(--muted)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" aria-hidden />
          Loading project…
        </div>
        <main id="main-content" className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)]/30 border-t-[var(--primary)]" aria-hidden="true" />
            <p className="text-sm text-[var(--muted)]">Loading project…</p>
          </div>
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)]">
        <main id="main-content" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(245,158,11,0.12)] text-[#b45309]" aria-hidden="true">!</div>
          <h1 className="text-lg font-semibold text-[var(--ink)]">Couldn&apos;t load project</h1>
          <p className="max-w-sm text-sm text-[var(--body)] break-words">{loadError}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => window.location.reload()} className="inline-flex h-10 items-center justify-center rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] hover:bg-[var(--primary-active)]">Retry</button>
            <Link href="/" className="inline-flex h-10 items-center justify-center rounded-[9999px] border border-[var(--hairline-strong)] px-5 text-[15px] font-[500] text-[var(--ink)] hover:bg-[var(--surface-strong)]">Back to Dashboard</Link>
          </div>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] flex-col bg-[var(--canvas)]">
        <main id="main-content" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(220,38,38,0.08)] text-[var(--semantic-error)]" aria-hidden="true">
            !
          </div>
          <h1 className="text-lg font-semibold text-[var(--ink)]">Project not found</h1>
          <p className="max-w-sm text-sm text-[var(--body)]">This project may have been deleted or the link is incorrect.</p>
          <Link
            href="/"
            className="mt-2 inline-flex h-10 items-center justify-center rounded-[9999px] bg-[var(--primary)] px-5 text-[15px] font-[500] text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] hover:bg-[var(--primary-active)]"
          >
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (!project) return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center p-8">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)]/30 border-t-[var(--primary)]" aria-hidden />
    </div>
  );

  return (
    <EditorProvider initialProject={project}>
      <EditorShell />
    </EditorProvider>
  );
}
