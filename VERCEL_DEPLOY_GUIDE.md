# CapAI — Vercel Deploy Guide

> Workspace: `D:\PROJECTS\Undone Projects\Cap Ai` (Windows path contains spaces — handle quoting).  
> Status: `next build --webpack` passes locally. Repo is git-initialized, `LICENSE` = All Rights Reserved.

## 1) Preflight (already verified)

| Check | Expected | Status |
|---|---|---|
| `package.json` `build` | `next build --webpack` (Windows webpack flag required) | ✅ |
| `vercel.json` | pinned `buildCommand: npm run build`, `outputDirectory: .next`, `framework: nextjs` | ✅ created |
| `next.config.ts` headers | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (SharedArrayBuffer for FFmpeg.wasm) + CSP/HSTS | ✅ — Vercel respects `next.config.ts` `headers()`; no `vercel.json` headers needed |
| `public/ffmpeg/*` tracked | ~129 MB vendored wasm (4× ~32 MB) must be committed — `.gitignore` must NOT contain `public/ffmpeg/` | ✅ tracked, `git check-ignore` returns no match |
| `npm run build` | passes | ✅ |

### Key files

**`vercel.json`** (committed — ensures Vercel runs the Windows-required flag):

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install"
}
```

Without this, some Vercel heuristics run `next build` without `--webpack`, which breaks Windows-parity builds. With `npm run build` pinned, Vercel uses the webpack builder.

**`next.config.ts:5-65`** — COOP/COEP/CSP are emitted via Next.js headers, so Vercel's edge automatically sends them. Do **not** duplicate in `vercel.json`.

**`.gitignore`** — must keep `public/ffmpeg/` committed. Current `.gitignore` only ignores `temp-e2e/downloads/*.mp4|*.webm`, `node_modules`, `.next`, etc. — correct. If you ever add a blanket `public/` ignore, add `!public/ffmpeg/**`.

## 2) Push to GitHub

Windows PowerShell — quote paths with spaces (or use `workdir` param in tooling):

```powershell
# from any shell, with explicit quoting:
git -C "D:\PROJECTS\Undone Projects\Cap Ai" status
git -C "D:\PROJECTS\Undone Projects\Cap Ai" log --oneline -5

# create repo on GitHub first (via gh CLI or web UI), then:
git -C "D:\PROJECTS\Undone Projects\Cap Ai" remote add origin https://github.com/<you>/capai.git
# or if origin already exists:
git -C "D:\PROJECTS\Undone Projects\Cap Ai" remote -v

git -C "D:\PROJECTS\Undone Projects\Cap Ai" add -A
git -C "D:\PROJECTS\Undone Projects\Cap Ai" commit -m "chore: vercel deploy ready (vercel.json + ffmpeg tracked)"
git -C "D:\PROJECTS\Undone Projects\Cap Ai" push -u origin main
```

> `public/ffmpeg/*.wasm` are ~32 MB each (4 copies = ~129 MB). GitHub allows files ≤100 MB; each wasm is 32 MB so it pushes fine. The repo total will be large — first push may take a minute. Do not use Git LFS for these; Vercel serves static files from `public/` directly.

Alternative (GitHub CLI, handles spaces):

```powershell
gh repo create capai --public --source="D:\PROJECTS\Undone Projects\Cap Ai" --remote=origin --push
# for private:
gh repo create capai --private --source="D:\PROJECTS\Undone Projects\Cap Ai" --remote=origin --push
```

## 3) Import on Vercel

1. Go to https://vercel.com/new
2. **Add New… → Project → Import Git Repository** → select `capai` (if private repo is missing, see §7).
3. Configure:
   - **Framework Preset:** `Next.js` (auto-detected via `next.config.ts` + `package.json`)
   - **Root Directory:** `.` (leave as `.` / blank — monorepo not used)
   - **Build Command:** `npm run build`  *(override if Vercel shows `next build` — must be `npm run build` to include `--webpack`)*
   - **Output Directory:** `.next` *(default)*
   - **Install Command:** `npm install`
   - **Node Version:** 20+ (Vercel default is fine; project uses `next@16.3.4`)
4. **Environment Variables:** _None required._
   - Gemini API keys are stored **client-side in `localStorage`** (open `Settings` in-app). Do not add `GEMINI_API_KEY` env vars — there is no server-side usage.
   - If you later add server actions that need keys, add them here and redeploy.
5. Click **Deploy**.

## 4) Verify

- Build logs should show `▲ Next.js 16.3.4 (webpack)` + `✓ Compiled successfully` (same as local `npm run build`).
- Visit `https://<your-project>.vercel.app` (e.g. `https://capai.vercel.app` if that slug is free — otherwise Vercel assigns `capai-xxx.vercel.app`; rename in Settings → Domains).
- Check FFmpeg: open a project → Processing page → export. Should load `/_next/static` + `/ffmpeg/ffmpeg-core.wasm` with `200`. Verify headers in DevTools → Network → any document request → Response Headers include `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: require-corp`.
- If export fails with `SharedArrayBuffer is not defined`, headers are missing — confirm `next.config.ts` is committed and not overridden by `vercel.json` `headers`.

## 5) Custom Domain

1. Vercel Dashboard → Project → **Settings → Domains**.
2. Add `capai.app` / `www.capai.app` (or your domain).
3. Follow DNS instructions:
   - **Vercel DNS (recommended):** change nameservers to `ns1.vercel-dns.com` / `ns2.vercel-dns.com`.
   - **External DNS:** add `A 76.76.21.21` or `CNAME cname.vercel-dns.com` as Vercel shows.
4. Vercel auto-provisions TLS (Let's Encrypt). Wait ~60s, then `https://yourdomain.com` works.
5. Set primary domain (redirect `www` → apex or vice-versa) in Domains settings.

## 6) Analytics / Extras

- **Vercel Analytics:** Project → **Analytics → Enable** (Web Vitals, no code change).
- **Speed Insights:** `npm i @vercel/speed-insights` + add `<SpeedInsights />` to `src/app/layout.tsx` (optional).
- **Logs & Monitoring:** Project → **Logs** (build + runtime). FFmpeg runs client-side, so server logs are minimal.
- **Previews:** every `git push` to a non-`main` branch creates a preview deployment automatically.

## 7) Private Repo on Hobby

Private GitHub repos **do work** on Vercel Hobby (free):

1. During **Import Git Repository**, if the private repo isn't listed → **Adjust GitHub App Permissions** (link on import screen) → grant the Vercel GitHub App access to the private repo (all repos or select `capai`).
2. Or: GitHub → Settings → Applications → **Vercel** → Repository access → add `capai`.
3. Re-visit https://vercel.com/new — the repo will now appear.
4. No extra Vercel plan needed for private repos on import; Hobby allows it via the GitHub App. Collaboration/seat limits still apply per Vercel pricing.

## 8) Troubleshooting

| Symptom | Fix |
|---|---|
| Build runs `next build` without `--webpack` | Ensure `vercel.json` is committed and **Build Command** override on Vercel is `npm run build` |
| `public/ffmpeg/*.wasm` 404 | Confirm files are committed (`git ls-files -- public/ffmpeg` should list 8 files). If `.gitignore` ever blocked them, remove the pattern, `git add -f public/ffmpeg/**`, push |
| `SharedArrayBuffer is not defined` | Headers not sent — check `next.config.ts` headers on production (curl -I https://...). Vercel respects `headers()` — ensure file is committed |
| GitHub push fails `file exceeds GitHub's file size limit` | A file >100 MB was added — current wasm files are 32 MB each, so safe. Check `git status` for accidental large artifacts (`temp-e2e/downloads/`) — those are gitignored |
| Windows path errors in CI | Always quote `D:\PROJECTS\Undone Projects\Cap Ai` or use `git -C "…"` / tool `workdir` param |

## 9) Post-deploy Checklist

- [ ] `https://capai.vercel.app` loads (or your project URL)
- [ ] DevTools → Network → document headers include COOP/COEP
- [ ] In-app: create project → add clip → Processing → Export succeeds (FFmpeg wasm loads)
- [ ] `localStorage` Gemini key still works (client-side)
- [ ] Custom domain TLS valid
- [ ] Analytics enabled (optional)

---
*Generated for Vercel deploy readiness — `npm run build` verified 2026-09-07.*
