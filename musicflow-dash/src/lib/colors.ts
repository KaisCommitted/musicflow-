/** Dominant-color helpers used for the dynamic accent. */

const FALLBACK = "oklch(0.72 0.18 48)";

function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic pleasant color for songs with no embedded artwork. */
export function colorFromString(str: string) {
  const h = hash(str) % 360;
  return `oklch(0.68 0.15 ${h})`;
}

/** Stable two-stop gradient used as artwork placeholder. */
export function gradientFromString(str: string) {
  const h = hash(str) % 360;
  return `linear-gradient(135deg, oklch(0.55 0.16 ${h}), oklch(0.32 0.09 ${(h + 48) % 360}))`;
}

/** Extract the dominant color of an image URL (same-origin / CORS friendly). */
export function dominantColorFromImage(src: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(FALLBACK);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(FALLBACK);
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(FALLBACK);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i] ?? 0;
          const pg = data[i + 1] ?? 0;
          const pb = data[i + 2] ?? 0;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);

          // skip near-greyscale and very dark pixels so the accent stays vivid
          if (max - min < 24 || max < 40) continue;
          r += pr;
          g += pg;
          b += pb;
          n++;
        }
        if (!n) return resolve(FALLBACK);
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(FALLBACK);
      }
    };
    img.src = src;
  });
}

export function applyDynamicColor(color: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--dynamic", color);
}
