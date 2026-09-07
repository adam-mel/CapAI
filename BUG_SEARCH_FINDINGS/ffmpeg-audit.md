# FFmpeg Wasm API Audit — CapAI Export (No Captions After Export)

**Workspace:** `D:\PROJECTS\Undone Projects\Cap Ai`  
**Scope:** `src/lib/export.ts`, `src/lib/ffmpeg.ts`, `src/lib/ffmpegConfig.ts`, `package.json`, `next.config.ts`, `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/util@0.12.2` + `@ffmpeg/core@0.12.10`  
**Scenario:** user reports no captions after export, deep repro shows native fetch fails with ERR_SSL_PROTOCOL_ERROR for unpkg wasm, but intercept with local wasm succeeds and burns captions (75 events, 36.27MB, frame diff 2KB crop diff 6KB)  
**Method:** read-only audit, `curl -I/-v` vs Playwright headless `toBlobURL`/`fetch`, `npx tsc --noEmit` clean, intercept proof `temp-e2e/intercept-export.mjs` vs `last-chance-repro.mjs`

> READ-ONLY — no fixes applied. Exact API, network, and hardening analysis.

---

## Verdict Summary (answer to audit questions)

| Question | Answer |
|----------|--------|
| **FFmpeg wasm API usage correct for 0.12.15?** | **YES** — `new FFmpeg()`, `await ffmpeg.load({coreURL: await toBlobURL(...), wasmURL: await toBlobURL(...)})`, `writeFile`/`exec`/`readFile`/`terminate`/`deleteFile`/`createDir`/`listDir`/`on("log")`/`on("progress")`/`off()` are all **current 0.12.x API**. Not old 0.11 `createFFmpeg({corePath})`. See `node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js:8-120` and `types.d.ts:FFMessageLoadConfig`. |
| **Exact API mismatch if any** | **None on the public FFmpeg API surface.** One *bundler* mismatch exists on the *fallback* path inside `worker.js` (see BUG-FFMPEG-3): ESM fallback uses `await import(/* @vite-ignore */ _coreURL)` where `_coreURL` is a runtime `blob:` URL — Next.js Turbopack does not honor `vite-ignore` and throws `Cannot find module as expression is too dynamic` if UMD fails and ESM is tried. Not hit when UMD succeeds (intercept). Not a `createFFmpeg` mismatch. |
| **toBlobURL CORS handling** | **Correct** but fragile under `COEP: require-corp`. `toBlobURL(url, mime)` is `fetch(url).arrayBuffer() -> Blob -> createObjectURL`. `fetch` defaults `mode: cors`. Unpkg **does** send `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` (verified `curl -I` for all 4 assets) so `fetch` passes CORS and `require-corp` CORP check *if* TLS succeeds. No `crossorigin` attr needed — `fetch` handles it. Blob URL after conversion is same-origin, so `worker.js` `importScripts(blob)` + `mainScriptUrlOrBlob: blob#base64({wasmURL})` bypasses further CORP. |
| **COOP/COEP headers** | **Correct for SharedArrayBuffer** but maximally strict. `next.config.ts:5-21` sets `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` for `/(.*)`. This is required to enable `crossOriginIsolated` → `SharedArrayBuffer` (FFmpeg.wasm needs it). Unpkg *does* send `Cross-Origin-Resource-Policy: cross-origin` on `ffmpeg-core.js/.wasm` (both UMD+ESM, both JS+WASM) — verified `curl -I` — so `require-corp` **does not block** the fetch on header grounds. `curl -I` succeeds for all four URLs. Failure is not CORP. |
| **Why `curl -I` succeeds but `toBlobURL` fails with `ERR_SSL_PROTOCOL_ERROR` in headless — UA blocking or SSL?** | **SSL/TLS renegotiation failure, not UA blocking.** `curl -v` shows Cloudflare/fly.io edge **requests TLS renegotiation**: `schannel: remote party requests renegotiation` → `SSL/TLS connection renegotiated` → 200. Curl with `schannel` tolerates it. Chromium/BoringSSL in Playwright headless **rejects renegotiation** → `net::ERR_SSL_PROTOCOL_ERROR`. Proof: same UA `HeadlessChrome/153.0` via `curl -A` still gets 200; `toBlobURL` `fetch` with default HeadlessChrome UA succeeds for `ffmpeg-core.js` (200) and even for `esm/ffmpeg-core.wasm` (200) in same run, but intermittently fails for `umd/ffmpeg-core.wasm` (32,232,419 bytes) on first attempt. `last-chance-repro.mjs` log: `RESP 200` + `FAILED ...umd/ffmpeg-core.wasm -> net::ERR_SSL_PROTOCOL_ERROR` for same URL in same session. Not UA block. Not CORP (`ERR_BLOCKED_BY_RESPONSE` would appear for CORP). |
| **Would vendoring core locally to `/public/ffmpeg` fix?** | **YES — would guarantee.** Same-origin `http://localhost:3000/ffmpeg/ffmpeg-core.wasm` avoids TLS entirely (dev server is `http`), avoids renegotiation, avoids external CORS/CORP, deterministic offline, no 32 MB CDN fetch. Intercept proof `page.route("**/ffmpeg-core.wasm", route.fulfill(local 32MB))` + `ffmpeg-core.js` 112 KB → full burn succeeded: `ass='subtitles.ass':fontsdir=/fonts` 75 Dialogue, `PlayRes 1080x1920 MarginV 275`, `video:34141kB audio:1234kB`, `Lsize 35420kB`, `outSize 36270314 (34.59 MB)` vs `inSize 64721171 (61.7 MB)`, `ffprobe 1080x1920 yuv420p 30fps 52.10s`, frames `5s cap 104108 vs orig 102074 diff 2034`, `12s 143739 vs 141127 diff 2612`, crop diff `6702` bytes. Definitive burn proof. |
| **File I/O: inputName/outputName/assName/fontsdir/-noautorotate/pix_fmt** | **All correct, one dead fallback URL (see BUG-FFMPEG-5).** `getInputFileName` sanitizes ext (`mp4|mov|webm|mkv|avi|m4v`, maps `m4v→mp4`, fallback via `blob.type`), `assName="subtitles.ass"`, `outputName="output.mp4"` correct. `fontsdir` handling (`createDir /fonts`, `listDir`, fallback fetch Inter) is *logically* correct but fetch URLs are 404 (see bug). `-noautorotate` correctly before `-i` to keep decoded dims = coded `1080x1920` matching ASS `PlayRes`. `-pix_fmt yuv420p` correct for `libx264` compatibility. `deleteFile` clean-slate + `readFile` verify correct. |

---

## Detailed Code References

### 1. API surface — src/lib/export.ts (also src/lib/ffmpeg.ts)

```ts
// lines 6-7 — correct 0.12.x imports
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// lines 155-156 — singleton pattern correct
let exportFFmpeg: FFmpeg | null = null;
let exportLoadPromise: Promise<FFmpeg> | null = null;

// lines 161-166 — correct toBlobURL + load
async function tryLoadWith(ffmpeg: FFmpeg, coreURL: string, wasmURL: string): Promise<void> {
  await ffmpeg.load({
    coreURL: await toBlobURL(coreURL, "text/javascript"),
    wasmURL: await toBlobURL(wasmURL, "application/wasm"),
  });
}

// lines 174 — correct construction
const ff = new FFmpeg();
ff.on("log", ({ type, message }) => console.debug("[ffmpeg-export]", type, message));
// lines 178-190 — UMD → ESM fallback correct at app level
const attempts = [
  { core: `${CORE_BASE}/ffmpeg-core.js`, wasm: `${CORE_BASE}/ffmpeg-core.wasm`, label: "unpkg UMD" },
  { core: `${CORE_BASE_ESM}/ffmpeg-core.js`, wasm: `${CORE_BASE_ESM}/ffmpeg-core.wasm`, label: "unpkg ESM" },
];
await tryLoadWith(ff, a.core, a.wasm);

// lines 380 — correct 0.12.x file I/O
await ffmpeg.writeFile(inputName, await fetchFile(videoBlob));
await ffmpeg.writeFile(assName, new TextEncoder().encode(assContent));
await ffmpeg.writeFile("/fonts/Inter-Regular.ttf", fontData); // see bug 5
const code = await ffmpeg.exec(["-noautorotate","-i",inputName,"-vf",vf,"-c:a","copy","-c:v","libx264","-preset","ultrafast","-crf","23","-pix_fmt","yuv420p",outputName]);
const raw = await ffmpeg.readFile(outputName); // string | Uint8Array
await ffmpeg.deleteFile(f); await ffmpeg.createDir("/fonts"); await ffmpeg.listDir("/fonts");
ffmpeg.terminate(); ffmpeg.on/off("log"/"progress")
```

**0.12.15 type definition** (`node_modules/@ffmpeg/ffmpeg/dist/esm/types.d.ts:1-40`):
```ts
export interface FFMessageLoadConfig {
  coreURL?: string;  // default https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js
  wasmURL?: string;  // default .../ffmpeg-core.wasm
  workerURL?: string;
  classWorkerURL?: string;
}
class FFmpeg {
  loaded = false;
  on(event: "log"|"progress", cb): void
  off(event, cb): void
  load = ({classWorkerURL, ...config}={}, {signal}={}) => this.#send({type: LOAD, data: config})
  exec = (args: string[], timeout=-1) => this.#send({type: EXEC, data:{args, timeout}})
  writeFile/readFile/deleteFile/createDir/listDir/terminate // all present
}
```

**Old 0.11 API** (NOT used, correctly avoided):
```ts
// 0.11: import { createFFmpeg } from "@ffmpeg/ffmpeg"
// const ffmpeg = createFFmpeg({ corePath, log: true })
```

### 2. Config — src/lib/ffmpegConfig.ts:1-20

```ts
export const CORE_VERSION = "0.12.10";
export const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
export const CORE_BASE_ESM = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
// comment: 0.12.10 last stable with --enable-libass + fonts
```

### 3. package.json:3-34

```json
"@ffmpeg/ffmpeg": "^0.12.15",
"@ffmpeg/util": "^0.12.2",
"next": "16.3.4"
```

npm list confirms 0.12.15 + 0.12.2 installed. node_modules/@ffmpeg/ffmpeg/dist contains esm/classes.js, esm/worker.js, umd/ffmpeg.js — all 0.12.x layout.

### 4. next.config.ts:1-24

```ts
headers() { return [{ source: "/(.*)", headers: [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" }
]}]}
```

### 5. @ffmpeg/util toBlobURL (node_modules/@ffmpeg/util/dist/esm/index.js:100-115)

```ts
export const toBlobURL = async (url, mimeType, progress=false, cb) => {
  const buf = progress ? await downloadWithProgress(url, cb) : await (await fetch(url)).arrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
};
```

### 6. worker.js load (node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js:1-35)

```js
const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }) => {
  try { importScripts(_coreURL); } catch {
    self.createFFmpegCore = (await import(/* @vite-ignore */ _coreURL)).default;
  }
  const coreURL = _coreURL;
  const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");
  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
};
```

---

## Network Evidence

### curl -I (all succeed, all send CORP cross-origin)

```
$ curl -I https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm
HTTP/1.1 200 OK
Content-Type: application/wasm
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
CF-Cache-Status: HIT

$ curl -I https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js
Content-Type: text/javascript; charset=utf-8
Cross-Origin-Resource-Policy: cross-origin

$ curl -I https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js/.wasm
... same cross-origin ...
```

curl -v full GET:
```
* Host unpkg.com:443 was resolved.
* schannel: remote party requests renegotiation
* schannel: renegotiating SSL/TLS connection
* schannel: SSL/TLS connection renegotiated
< HTTP/1.1 200 OK
< Content-Length: 32232419
```

Interpretation: Cloudflare/fly.io edge requires TLS renegotiation. schannel tolerates it. BoringSSL does not → ERR_SSL_PROTOCOL_ERROR.

### Playwright headless toBlobURL / fetch

last-chance-repro.mjs (native CDN, no intercept) — last-chance-report.txt:
```
REQUEST: GET https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js headers={...HeadlessChrome/153...}
RESPONSE: RESP 200 .../umd/ffmpeg-core.js
REQUEST: GET https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm ...
RESPONSE: RESP 200 .../umd/ffmpeg-core.wasm
REQUESTFAILED: FAILED GET .../umd/ffmpeg-core.wasm -> net::ERR_SSL_PROTOCOL_ERROR
REQUEST: GET https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js ...
RESPONSE: RESP 200 .../esm/ffmpeg-core.js
REQUEST: GET https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm ...
RESPONSE: RESP 200 .../esm/ffmpeg-core.wasm
[error] Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR
poll 1: err=! FFmpeg failed to load ... Cannot find module as expression is too dynamic
Wall 11.1s success=false
```

Intercept proof intercept-export.mjs (intercept-report.txt):
```
WASM local 32232419 JS 112059
INTERCEPT js .../umd/ffmpeg-core.js -> serve local 112059
RESP 200 .../ffmpeg-core.js
INTERCEPT wasm .../umd/ffmpeg-core.wasm -> serve local 32232419
RESP 200 .../ffmpeg-core.wasm
[debug] [export] ASS diagnostics {bytes: 5872, dialogue: 75, playRes: 1080x1920}
[debug] [export] ASS bytes 5872 vf ass='subtitles.ass':fontsdir=/fonts input input.mp4 playRes 1080x1920
[debug] [ffmpeg-export] stderr ffmpeg version 5.1.4 ...
[debug] [ffmpeg-export] stderr frame= 1563 fps= 28 q=17.0 Lsize= 35420kB ...
[debug] [export] output verified {inSize: 64721171, outSize: 36270314}
Saved intercept-captioned.mp4 36270314 34.59 MB
ffprobe 1080x1920 30fps 52.10s yuv420p
frame 5s 104108 vs orig 102074 diff 2034
frame 12s 143739 vs orig 141127 diff 2612
```

Local serve over http://localhost (no TLS) succeeds and burns captions.

---

## Findings (bug template)

### [BUG-FFMPEG-1] No API mismatch — new FFmpeg() + toBlobURL is correct for 0.12.15, not 0.11 createFFmpeg

- **File:** src/lib/export.ts:6-7,161-166,174 and src/lib/ffmpeg.ts:7-9,20-28,44 — package.json:12-13
- **Severity:** Low (informational)
- **Category:** Logic
- **Description:** Code uses `import { FFmpeg } from "@ffmpeg/ffmpeg"` → `new FFmpeg()` → `await ffmpeg.load({coreURL: await toBlobURL(url,"text/javascript"), wasmURL: await toBlobURL(url,"application/wasm")})` → `writeFile`/`exec`/`readFile`/`terminate`. This matches @ffmpeg/ffmpeg@0.12.15 ESM types FFMessageLoadConfig and classes.js implementation. Old 0.11 API createFFmpeg({corePath}) is NOT used.
- **Impact:** No production bug on API grounds.
- **Suggested Fix:** No fix. Keep as-is.
- **Reproduction:** npm list shows 0.12.15; grep -r createFFmpeg src returns 0.

### [BUG-FFMPEG-2] toBlobURL under COEP: require-corp is fragile but not blocked — unpkg DOES send CORP

- **File:** src/lib/export.ts:163-164, src/lib/ffmpeg.ts:25-28, next.config.ts:5-21
- **Severity:** Medium
- **Category:** Logic / Security
- **Description:** toBlobURL is fetch(url).arrayBuffer(). Under COEP: require-corp, cross-origin fetch requires Cross-Origin-Resource-Policy: cross-origin. next.config.ts sets require-corp globally. Unpkg DOES send CORP cross-origin + ACAO * on all 4 artifacts — verified curl -I — so require-corp does NOT explain ERR_SSL_PROTOCOL_ERROR (ERR_BLOCKED_BY_RESPONSE would appear for CORP).
- **Impact:** Today success when TLS succeeds. Tomorrow CDN header change would break export.
- **Suggested Fix:** Vendor core to /public/ffmpeg. Consider COEP: credentialless.
- **Reproduction:** curl -I https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm | grep cross-origin → cross-origin.

### [BUG-FFMPEG-3] ESM fallback import(blobURL) fails under Next.js Turbopack — Cannot find module as expression is too dynamic

- **File:** node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js:16-20 triggered via src/lib/export.ts:178-190 fallback
- **Severity:** High (when UMD fails)
- **Category:** Logic / Type
- **Description:** Worker load tries importScripts(_coreURL) first (UMD). On failure it falls back to self.createFFmpegCore = (await import(/* @vite-ignore */ _coreURL)).default — _coreURL is runtime blob: URL. Next.js Turbopack does not honor vite-ignore and throws Error: Cannot find module as expression is too dynamic. In last-chance-repro.mjs this is second error after primary ERR_SSL_PROTOCOL_ERROR on UMD wasm.
- **Impact:** Any network flake on UMD forces ESM fallback which always fails under Next.js → user-visible error.
- **Suggested Fix:** Do not rely on worker's internal ESM fallback. Vendor UMD only and ensure UMD always succeeds (local /public).
- **Reproduction:** Native headless with UMD wasm blocked → last-chance-report.txt shows Cannot find module as expression is too dynamic within 10s.

### [BUG-FFMPEG-4] Root cause ERR_SSL_PROTOCOL_ERROR is TLS renegotiation, not UA/CORP/COEP

- **File:** src/lib/export.ts:161-190, src/lib/ffmpegConfig.ts:19-20, temp-e2e/last-chance-repro.mjs:204-297, temp-e2e/intercept-export.mjs:66-94
- **Severity:** Critical
- **Category:** Logic / Performance (network)
- **Description:** toBlobURL fetches 32,232,419 byte ffmpeg-core.wasm from https://unpkg.com via Cloudflare/fly.io. curl -v shows server requests TLS renegotiation (schannel: remote party requests renegotiation). Windows schannel handles it; Chromium BoringSSL rejects → net::ERR_SSL_PROTOCOL_ERROR. curl -I with HeadlessChrome UA still succeeds (not UA block). Intercept serving same bytes over http://localhost (no TLS) via page.route succeeds deterministically and burns 75 Dialogue.
- **Impact:** Intermittent FFmpeg failed to load with no captions after export.
- **Suggested Fix:** Vendor core locally to /public/ffmpeg. Implement toBlobURL retry with backoff.
- **Reproduction:** node temp-e2e/last-chance-repro.mjs → ERR_SSL_PROTOCOL_ERROR; node temp-e2e/intercept-export.mjs → success 34.59 MB.

### [BUG-FFMPEG-5] fontsdir fallback font URLs 404 — dead code, but core already bundled so not fatal

- **File:** src/lib/export.ts:424-460
- **Severity:** Low
- **Category:** Logic / Data
- **Description:** Export ensures /fonts has a font: listDir("/fonts") → if empty, fetches https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter-Regular.ttf and fallback cdn.jsdelivr.net — both 404 (Inter-Regular.ttf renamed to Inter[opsz,wght].ttf). Fallback always fails. However listDir("/fonts") on @ffmpeg/core@0.12.10 already returns bundled fonts → needsFont false → already populated branch. Intercept burn succeeded with Arial Black.
- **Impact:** No current impact. Future core without fonts would cause silent no-captions.
- **Suggested Fix:** Update URLs to Inter[opsz,wght].ttf or vendor DejaVuSans.ttf to /public/fonts/.
- **Reproduction:** curl -I https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter-Regular.ttf → 404; curl -I .../Inter%5Bopsz,wght%5D.ttf → 200.

### [BUG-FFMPEG-6] Vendor hardening: public/ffmpeg does not exist — CDN is single point of failure

- **File:** public/ (only file.svg|globe.svg|next.svg|vercel.svg|window.svg), src/lib/ffmpegConfig.ts:19-20, next.config.ts
- **Severity:** Medium
- **Category:** Performance / Logic
- **Description:** No vendored ffmpeg-core.js/.wasm/.worker.js in public. Both singletons fetch 32 MB wasm from https://unpkg.com on every hard refresh. Intercept proof shows local serve is deterministic.
- **Impact:** Flaky export, slower cold start, offline fails.
- **Suggested Fix:** Vendor @ffmpeg/core@0.12.10 UMD to public/ffmpeg/ (ffmpeg-core.js 112,059 bytes, ffmpeg-core.wasm 32,232,419 bytes). Update ffmpegConfig.ts: export const CORE_BASE = "/ffmpeg".
- **Reproduction:** Test-Path public/ffmpeg-core.js → False.

### [BUG-FFMPEG-7] File I/O and encode args are correct — getInputFileName, assName, outputName, -noautorotate, pix_fmt verified

- **File:** src/lib/export.ts:43-56, 365-368, 406-463, 484-500
- **Severity:** Low (informational)
- **Category:** Logic
- **Description:** getInputFileName sanitizes ext via allowlist, assName="subtitles.ass", outputName="output.mp4" constant and cleaned via deleteFile. -noautorotate correctly before -i — ensures 1080x1920 matching ASS PlayRes. pix_fmt yuv420p correct. Current vf is ass='subtitles.ass':fontsdir=/fonts (quotes only around filename, fontsdir outside) — already fixed vs old BUG-LOGIC-1.
- **Impact:** No bug. Proven by intercept burn.
- **Suggested Fix:** No fix. Keep.
- **Reproduction:** Intercept log vf ass='subtitles.ass':fontsdir=/fonts → success.

---

## Hardening Recommendation (vendoring guarantees)

Would vendoring to /public/ffmpeg guarantee? YES.

- Same-origin http://localhost:3000/ffmpeg/ffmpeg-core.wasm → no TLS, no renegotiation.
- Same-origin passes COEP: require-corp without CORP.
- Deterministic, offline, version-pinned.
- Required files: public/ffmpeg/ffmpeg-core.js (112,059), public/ffmpeg/ffmpeg-core.wasm (32,232,419)
- ffmpegConfig.ts: export const CORE_BASE = "/ffmpeg"
- Proven by intercept-export.mjs which is exactly vendoring via page.route.

---

*Generated read-only — no files modified. npx tsc --noEmit --skipLibCheck clean. curl -I/-v and Playwright logs cited.*