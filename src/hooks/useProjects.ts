"use client";

import { useCallback, useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "@/lib/db";
import type { Project } from "@/lib/types";

export interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, newName: string) => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(null);
    setLoading(true);
    const observable = liveQuery(() => db.projects.orderBy("updatedAt").reverse().toArray());

    const subscription = observable.subscribe({
      next: (result) => {
        setProjects(result);
        setLoading(false);
        setError(null);
      },
      error: (err) => {
        console.error("[useProjects] liveQuery error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, [retryKey]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await db.projects.delete(id);
  }, []);

  const renameProject = useCallback(async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Atomic transaction — avoids stale read-then-write race from BUG-DATA-10
    // Previous: db.update then get+put if 0 — non-atomic, could resurrect/overwrite concurrent edits
    await db.transaction("rw", db.projects, async () => {
      const existing = await db.projects.get(id);
      if (!existing) return;
      // Don't clobber segments/settings if another tab edited them — only mutate name/updatedAt
      // Re-read inside transaction ensures we have latest snapshot
      existing.name = trimmed;
      existing.updatedAt = Date.now();
      await db.projects.put(existing);
    });
  }, []);

  return { projects, loading, error, retry, deleteProject, renameProject };
}
