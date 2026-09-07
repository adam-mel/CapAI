# CapAI — GitHub + Vercel Protection Guide

> © 2026 CapAI — All Rights Reserved. Viewing only.

This guide leaves your repo **ready to push** without actually pushing (no token needed). Follow it verbatim — Windows paths with spaces are handled via `-LiteralPath`.

---

## 1) Repo visibility: Public vs Private

| Choice | What it does | When to choose |
|--------|--------------|----------------|
| **Public + LICENSE (All Rights Reserved)** | Anyone can *see* code; Download ZIP / Clone still works (GitHub never disables it on public repos). **License legally prohibits** copy/fork/reuse/claiming. Best for portfolio visibility. You can enforce via DMCA. | **Recommended** — you want "postable on GitHub, protected from stealing." |
| **Private** | Only you (and collaborators you add) can see/clone. No public portfolio. Vercel can still deploy from private (grant Vercel access during import). | Choose if you truly don't want anyone to see code at all. |

**You cannot technically disable "Download ZIP" on a public repo.** The protection is **legal**, not technical. A proprietary `LICENSE` + copyright headers + DMCA is the strongest GitHub offers. GitHub honors DMCA takedowns if someone copies.

**Recommendation for CapAI:** Public with `LICENSE` (All Rights Reserved) — maximum visibility + maximum legal protection. Vercel works either way.

---

## 2) First push (local is already `git init` + committed — just add remote)

Local repo is initialized at `D:\PROJECTS\Undone Projects\Cap Ai` with `user.name=CapAI`, `user.email=contact@capai.local` (edit before pushing if you want your real identity).

```powershell
# Verify — must show .git exists
Test-Path -LiteralPath "D:\PROJECTS\Undone Projects\Cap Ai\.git"

# Check status (should be clean after initial commit)
git -C "D:\PROJECTS\Undone Projects\Cap Ai" status

# Create repo on GitHub (web):
# github.com → New repository → Name: capai → Visibility: Public → DO NOT init with README/LICENSE (we already have them) → Create

# Add remote (replace YOURUSERNAME)
git -C "D:\PROJECTS\Undone Projects\Cap Ai" branch -M main
git -C "D:\PROJECTS\Undone Projects\Cap Ai" remote add origin https://github.com/YOURUSERNAME/capai.git
git -C "D:\PROJECTS\Undone Projects\Cap Ai" push -u origin main
```

If you prefer SSH: `git@github.com:YOURUSERNAME/capai.git`.

After push, **replace `[your email]` in `LICENSE`** with your real contact before publishing (search for `your email`).

---

## 3) GitHub repo settings (hardening)

In GitHub → Settings for the repo:

1. **General → Features**
   - Uncheck **Allow forking**? Not available — forking is allowed on public repos, but your LICENSE prohibits reuse. You can add a repo description: `© 2026 CapAI — All Rights Reserved. Viewing only.`
   - Disable **Issues** / **Discussions** if you don't want external contributions (optional).

2. **Branches → Branch protection rule** (for `main`)
   - Require pull request before merging
   - Require status checks (if you add CI)
   - Do not allow bypassing

3. **CODEOWNERS** — create `.github/CODEOWNERS`:
   ```
   * @YOURUSERNAME
   ```

4. **Require contributors to sign off (DCO)** — in repo → Settings → General → check "Require contributors to sign off on web-based commits" or enforce via branch rule + add `CONTRIBUTING.md` with DCO.

5. **Dependabot** — Settings → Code security → Enable **Dependabot alerts** + **Dependabot security updates**. Optionally add `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule: { interval: "weekly" }
   ```

6. **SECURITY.md** — create `SECURITY.md`:
   ```md
   # Security Policy
   To report a vulnerability, email [your email] — do not open a public issue.
   ```

7. **About section** — set Website to your Vercel URL after deploy, Topics: `nextjs`, `ffmpeg-wasm`, `gemini`, `captions`.

---

## 4) Vercel deployment

Vercel deploys from public **or** private GitHub repos.

1. Go to https://vercel.com/new → Import `capai` repo.
2. Framework: **Next.js** (auto-detected).
3. Build command: `npm run build` (already `next build --webpack` in `package.json`).
4. No env vars needed for client-side mode. If you later proxy Gemini server-side, add `GEMINI_API_KEY` in Vercel → Settings → Environment Variables.
5. Deploy → Vercel assigns `capai-xxx.vercel.app`. Add custom domain if desired.

Re-deploys on every `git push` to `main`.

---

## 5) No secrets in repo — verified

- `src/lib/gemini.ts` contains **no hardcoded `AIza` / `AQ.` key** — only `?key=` param insertion from user input + `localStorage`.
- `src/lib/geminiKeys.ts` stores keys obfuscated with `btoa` in `localStorage` + Dexie (still reversible — documented as theatre; use server proxy for billed keys).
- No `.env` / `.env.local` exists locally; `.gitignore` covers `.env*` + `*.log` + `.vercel` + `temp-e2e/downloads/*.mp4|*.webm`.

**Before every commit**, run:

```powershell
Select-String -Path "D:\PROJECTS\Undone Projects\Cap Ai\src\lib\*.ts" -Pattern "AIza|AQ\." | Where-Object { $_.Line -notmatch "startsWith|maskKey|KEY_RE" }
```

If a real key appears, **rotate it immediately** in Google AI Studio and remove it from git history (`git filter-repo` or `BFG`).

---

## 6) Copyright headers

Added to `src/app/layout.tsx` and `src/lib/gemini.ts`:

```ts
// © 2026 CapAI — All Rights Reserved. Viewing only.
```

Add to more files as desired — the LICENSE at repo root is the binding term; headers are notice.

---

## 7) Legal enforcement

If someone copies your code:

1. Collect evidence (URL, commit dates, your earlier `git log`).
2. File GitHub DMCA takedown: https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-request
3. GitHub removes the fork/clone. Your original commit history proves priority.

---

## 8) Checklist before making public

- [ ] Replace `[your email]` in `LICENSE` and `SECURITY.md` (if added)
- [ ] `git status` clean, `npm run build` passes
- [ ] `.gitignore` covers `.env*`, `.vercel`, `temp-e2e/downloads`
- [ ] `README.md` + `LICENSE` show **All Rights Reserved**
- [ ] Push to `main` and set About → `© 2026 CapAI — All Rights Reserved`
- [ ] Enable Dependabot + branch protection
- [ ] Import to Vercel

---

*Prepared for CapAI — Windows LiteralPath-safe, no remote push performed. Next step: run the push commands above with your GitHub username.*
