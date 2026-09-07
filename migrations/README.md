# CapAI — Data Migrations

This is a **local-first IndexedDB (Dexie)** app — there are no SQL migrations. The schema lives in `src/lib/db.ts` via `Dexie.version(n).stores({...})`.

## Version history

| Dexie version | Stores | Notes |
|---|---|---|
| 1 | `projects: "id, name, createdAt, updatedAt"` | Initial — projects with video Blob + segments |
| 2 | `projects: "id, name, createdAt, updatedAt"` + `apiKeys: "id, priority, isActive"` | Adds Gemini multi-key mirror (btoa-obfuscated). Upgrade hook is no-op but preserves projects. |

## Conventions

- **Always re-declare all stores** in each new `version(n).stores({...})` call. Dexie merges unspecified stores, but explicit redeclaration documents intent and prevents accidental store drops on fresh installs (new DB skips v1 and applies latest version directly).
- Add an `.upgrade(tx => {...})` hook for any field backfill / truncation fixes (e.g., sanitizing `thumbnailDataUrl`, clamping `wordsPerSegment`).
- Bump `DB_VERSION` in `src/lib/types.ts` and `src/lib/db.ts` together.
- Add a Dexie hook (`db.projects.hook('creating'|'updating', ...)`) for runtime validation at the persistence boundary (see `src/lib/db.ts`).

## Adding v3 (example)

```ts
this.version(3)
  .stores({
    projects: "id, name, createdAt, updatedAt, *name", // added index example
    apiKeys: "id, priority, isActive",
  })
  .upgrade(async tx => {
    await tx.table("projects").toCollection().modify(p => {
      if (!p.createdAt) p.createdAt = p.updatedAt ?? Date.now();
    });
  });
```

## Verification

Delete `capai_db` in DevTools → Application → IndexedDB and reload. Both `projects` and `apiKeys` should exist with correct indexes. There are no `*.sql` files — `glob ** /*.sql` is intentionally empty for this Dexie project.

## DB tests

No `pgTAP` (not Postgres). Add integration tests that `Dexie.delete("capai_db")` then assert both tables exist after opening.
