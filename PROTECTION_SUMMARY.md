# CapAI — Protection Summary (Final)

> © 2026 CapAI — All Rights Reserved. Viewing only. See [LICENSE](./LICENSE).

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai` — Windows path with spaces. Always quote or use `git -C "D:\PROJECTS\Undone Projects\Cap Ai"`.

---

## 1) The hard truth (GitHub)

**You cannot technically disable Clone / Download ZIP / Fork on a public GitHub repo.** If the repo is public, anyone can `git clone https://github.com/you/capai.git` or click `Code → Download ZIP`. GitHub has no setting to turn this off (forking can be disabled only for orgs with specific settings, but clone always works).

**The protection is legal, not technical:** a proprietary `LICENSE` at the repo root. GitHub prominently shows the license, and it is legally binding. Cloning is allowed to *view*; **copying, reusing, selling, or claiming as theirs violates the license** and is subject to DMCA takedown.

All required files are already in place — see verification §6.

---

## 2) Best protection options — pick one

### Option A — Recommended for CapAI: Public + All Rights Reserved LICENSE

| Pros | Cons |
|------|------|
| Portfolio visibility — recruiters/clients see your work | Clone button technically works (but license forbids reuse) |
| GitHub social proof (stars, discovery) | Must enforce via DMCA if copied (usually one form) |
| Strongest hiring signal | |

**How it protects:** `LICENSE` states *viewing only* — forbids copy/clone/fork/modify/distribute/sublicense/sell/claim as own. Anyone who copies and publishes is violating copyright. You file a DMCA; GitHub removes their copy within days. Your `git log` proves you were first.

**Use this if:** you want to showcase CapAI while keeping legal ownership. **This is what is currently configured.**

### Option B — Private repo — 100% no download

| Pros | Cons |
|------|------|
| No one can see or clone code at all | No portfolio visibility |
| No risk of casual copying | Harder to share work for hiring |
| Vercel still deploys (Hobby supports private) | Must grant read access per collaborator |

**How to switch:** On GitHub → New repo → **Private** (or Settings → General → Visibility → Make private). Vercel import still works — grant Vercel GitHub App access when prompted (Import → Adjust GitHub App Permissions → select `capai`).

**Use this if:** you truly don't want anyone to see the code — ever — and don't need public portfolio.

> You can start **Private** now and flip to **Public** later, or keep private and share a Vercel URL instead of GitHub.

---

## 3) How DMCA works (if someone steals it)

1. **Collect evidence:** their repo URL, your repo URL, `git log --oneline` showing your earlier commits (your history is timestamped + hashed).
2. **File:** https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-request → GitHub's DMCA form (or email).
3. **GitHub acts:** removes the infringing fork/clone, notifies the infringer. Counter-notice is rare when you own clear commit history.
4. **Keep proof:** your initial commit `2626e63` + signed commits are your priority proof. Optionally push to a second remote/back-up.

No registration fee. Works for public repos worldwide.

---

## 4) Extra hardening (already documented, do after first push)

1. **CODEOWNERS** — create `.github/CODEOWNERS`:
   ```
   * @YOURUSERNAME
   ```
2. **Branch protection** — GitHub → Settings → Branches → Add rule for `main`: Require PR, require status checks, block force-push, block deletion.
3. **Forking note:** you cannot disable the Fork button on public repos — the `LICENSE` is what forbids forking for reuse. Add repo description: `© 2026 CapAI — All Rights Reserved. Viewing only.`
4. **Watermark comments** — already in `src/app/layout.tsx` and `src/lib/gemini.ts`:
   ```ts
   // © 2026 CapAI — All Rights Reserved. Viewing only.
   ```
   Add to more entry files if desired — LICENSE at root is binding; headers are notice.
5. **No secrets** — verified: no `AIza`/`AQ.` hardcoded; keys live in `localStorage` only. `.gitignore` covers `.env*` + `.vercel` + `temp-e2e/downloads/*.mp4|*.webm`.
6. **Dependabot + SECURITY.md** — Settings → Code security → Dependabot alerts/updates; add `SECURITY.md` with contact email (see `GITHUB_PROTECTION_GUIDE.md:5-6`).

---

## 5) Next steps — push & deploy checklist

Run in **PowerShell** (spaces handled via `-LiteralPath` / `git -C`):

```powershell
# 0) Verify clean (from any directory)
git -C "D:\PROJECTS\Undone Projects\Cap Ai" status
git -C "D:\PROJECTS\Undone Projects\Cap Ai" log --oneline -5
Test-Path -LiteralPath "D:\PROJECTS\Undone Projects\Cap Ai\LICENSE"
Test-Path -LiteralPath "D:\PROJECTS\Undone Projects\Cap Ai\vercel.json"
git -C "D:\PROJECTS\Undone Projects\Cap Ai" ls-files -- "public/ffmpeg"  # should list 8 files

# 1) Set your real identity (replace before publishing)
git -C "D:\PROJECTS\Undone Projects\Cap Ai" config user.name "Your Name"
git -C "D:\PROJECTS\Undone Projects\Cap Ai" config user.email "you@yourdomain.com"
# Also edit LICENSE: replace [your email — replace before publishing]

# 2) Stage & commit remaining deploy files (if not yet pushed)
git -C "D:\PROJECTS\Undone Projects\Cap Ai" add -A
git -C "D:\PROJECTS\Undone Projects\Cap Ai" commit -m "chore: add protection summary + vercel deploy ready"

# 3) Create GitHub repo (web or gh CLI)
# Web: github.com → New repository → Name: capai → Public (or Private) → DO NOT init with README/LICENSE → Create
# Or CLI:
gh repo create capai --public --source="D:\PROJECTS\Undone Projects\Cap Ai" --remote=origin --push
# For private: gh repo create capai --private --source="D:\PROJECTS\Undone Projects\Cap Ai" --remote=origin --push

# 4) If repo already created manually:
git -C "D:\PROJECTS\Undone Projects\Cap Ai" branch -M main
git -C "D:\PROJECTS\Undone Projects\Cap Ai" remote add origin https://github.com/YOURUSERNAME/capai.git
git -C "D:\PROJECTS\Undone Projects\Cap Ai" push -u origin main
# SSH alt: git@github.com:YOURUSERNAME/capai.git

# 5) GitHub settings → About: description = © 2026 CapAI — All Rights Reserved. Viewing only.
#    Settings → Branches → protect main, Settings → Code security → Dependabot, add .github/CODEOWNERS

# 6) Deploy on Vercel
# vercel.com/new → Import capai → Framework Next.js → Build Command: npm run build → Deploy
# No env vars needed (Gemini key is per-user in browser localStorage)
# If private repo not listed: Import screen → Adjust GitHub App Permissions → grant access to capai
```

Post-deploy verify: `https://<your-project>.vercel.app` loads; DevTools → Network → document headers include `cross-origin-opener-policy: same-origin` + `cross-origin-embedder-policy: require-corp` (for FFmpeg SharedArrayBuffer); in-app export loads `/ffmpeg/ffmpeg-core.wasm` 200.

---

## 6) Verification (2026-09-07)

| File | Expected | Status |
|------|----------|--------|
| `LICENSE` | `Copyright (c) 2026 CapAI. All Rights Reserved.` + viewing-only terms + DMCA notice | ✅ 31 lines |
| `README.md` | Line 1 + §License both show `© 2026 CapAI — All Rights Reserved. Viewing only.` + link to LICENSE | ✅ `©` UTF-8 verified |
| `GITHUB_PROTECTION_GUIDE.md` | Public vs Private table, push commands with `LiteralPath`, DMCA link, hardening steps | ✅ 151 lines |
| `VERCEL_DEPLOY_GUIDE.md` | `vercel.json` pin, COOP/COEP headers via `next.config.ts`, private-on-Hobby, troubleshooting | ✅ 133 lines |
| `PROTECTION_SUMMARY.md` | This file — concise final guide covering §1-5 | ✅ |
| `.gitignore` | Covers `node_modules`, `.next`, `.vercel`, `.env*`, `*.log`, `temp-e2e/downloads/*.mp4|*.webm`; **does NOT** ignore `public/ffmpeg/` | ✅ |
| `vercel.json` | `{"framework":"nextjs","buildCommand":"npm run build","outputDirectory":".next","installCommand":"npm install"}` | ✅ tracked |
| `public/ffmpeg/` | 8 files (~129 MB) vendored, `git check-ignore` returns no match, `git ls-files` lists 8 | ✅ tracked |
| `git` | `git init` done, branch `main`, `user.name=CapAI` / `user.email=contact@capai.local` (update before push), initial commit `2626e63` | ✅ |
| `npm run build` | `next build --webpack` passes — `✓ Compiled successfully` `Next.js 16.3.4 (webpack)` | ✅ verified |

Full guides: [GITHUB_PROTECTION_GUIDE.md](./GITHUB_PROTECTION_GUIDE.md) · [VERCEL_DEPLOY_GUIDE.md](./VERCEL_DEPLOY_GUIDE.md) · [LICENSE](./LICENSE)

---

*If you keep repo Public, the LICENSE is your lock. If you keep it Private, the visibility is your lock. Either way, Vercel deploys. DMCA is your enforcement.*
