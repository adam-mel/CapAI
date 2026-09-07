/**
 * CapAI — Thumbnail generation
 * Extract first frame via video element + canvas → JPEG dataUrl 320×180
 * Used for ProjectCard thumbnail.
 */

export async function generateThumbnail(file: File): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("generateThumbnail can only run in the browser");
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");

    video.preload = "metadata";
    video.muted = true;
    (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    video.src = url;
    video.crossOrigin = "anonymous";

    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      // remove from DOM if appended
      if (video.parentNode) video.parentNode.removeChild(video);
    };

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const succeed = (dataUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(dataUrl);
    };

    // Auto-reject after 8s (large files / slow decode)
    const timeoutId = window.setTimeout(() => fail("thumbnail timeout"), 8000);

    video.addEventListener("loadedmetadata", () => {
      // Duration may be Infinity/NaN for some containers before seek — fallback to 0.5
      const duration = Number.isFinite(video.duration) ? video.duration : 1;
      const seekTime = duration > 1 ? Math.min(0.5, duration * 0.1) : 0.1;
      // Some browsers need a tiny delay before setting currentTime
      try {
        video.currentTime = seekTime;
      } catch {
        // If setting currentTime fails (no duration yet), retry on next tick
        window.setTimeout(() => {
          try {
            video.currentTime = 0.5;
          } catch {
            fail("seek failed");
          }
        }, 100);
      }
    });

    video.addEventListener("seeked", () => {
      // Wait one frame to ensure decoded pixel available
      requestAnimationFrame(() => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail("canvas context unavailable");
          return;
        }

        // Fill with light base to match light editorial surfaces (surface-strong)
        ctx.fillStyle = "#f0efed";
        ctx.fillRect(0, 0, 320, 180);

        if (!vw || !vh) {
          // Fallback: stretch (rare)
          try {
            ctx.drawImage(video, 0, 0, 320, 180);
          } catch {
            fail("drawImage failed");
            return;
          }
        } else {
          // Cover fit (16:9) — crop center
          const canvasRatio = 320 / 180;
          const videoRatio = vw / vh;
          let sx = 0,
            sy = 0,
            sw = vw,
            sh = vh;

          if (videoRatio > canvasRatio) {
            // wider → crop sides
            sh = vh;
            sw = sh * canvasRatio;
            sx = (vw - sw) / 2;
            sy = 0;
          } else {
            // taller → crop top/bottom
            sw = vw;
            sh = sw / canvasRatio;
            sx = 0;
            sy = (vh - sh) / 2;
          }

          try {
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 320, 180);
          } catch {
            fail("drawImage failed");
            return;
          }
        }

        let dataUrl: string;
        try {
          dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        } catch {
          fail("toDataURL failed");
          return;
        }

        // Validate JPEG dataUrl — guard against truncated / invalid captures
        // Must be JPEG base64, >1k (avoids truncated), <500k (avoids oversized)
        const isValid =
          typeof dataUrl === "string" &&
          dataUrl.startsWith("data:image/jpeg;base64,") &&
          dataUrl.length > 1000 &&
          dataUrl.length < 500000;

        if (!isValid) {
          window.clearTimeout(timeoutId);
          // Fallback to light placeholder instead of returning a broken truncated JPEG
          succeed(placeholderThumbnail());
          return;
        }

        window.clearTimeout(timeoutId);
        succeed(dataUrl);
      });
    });

    video.addEventListener("error", () => {
      window.clearTimeout(timeoutId);
      fail("video load failed");
    });

    // Append hidden video to DOM for Safari which requires it in document
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.muted = true;
    // Some browsers block autoplay without muted + playsInline — already set
    document.body.appendChild(video);
    // Trigger load
    video.load();
  });
}

/**
 * Light editorial placeholder — matches surface-card / hairline tokens
 * fill #f0efed (surface-strong), stroke #e7e5e4 (hairline), text #6e6862 (muted)
 * Keeps 320×180 to match canvas. Used when generation fails or no thumbnail yet.
 */
export function placeholderThumbnail(): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180' viewBox='0 0 320 180'><rect width='320' height='180' fill='#f0efed'/><rect x='0.5' y='0.5' width='319' height='179' rx='6' fill='none' stroke='#e7e5e4' stroke-opacity='0.8'/><text x='160' y='92' text-anchor='middle' font-family='Geist, Inter, sans-serif' font-size='28' fill='#6e6862'>✦</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Validate thumbnail dataUrl before rendering / storing.
 * Guards against truncated JPEG (ERR_INVALID_URL when length ~ few hundred)
 * and oversized blobs. Accepts only well-formed JPEG base64 >1k and <500k.
 * SVG placeholders from placeholderThumbnail() are treated as valid fallbacks.
 */
export function isValidThumbnailDataUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url) return false;
  // SVG placeholder is always valid (light fallback)
  if (url.startsWith("data:image/svg+xml")) return true;
  return url.startsWith("data:image/jpeg;base64,") && url.length > 1000 && url.length < 500000;
}
