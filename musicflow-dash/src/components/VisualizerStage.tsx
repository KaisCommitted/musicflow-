import { useEffect, useRef } from "react";
import type { AudioFeatures } from "@/lib/audio/features";
import { getVisualizer } from "@/lib/visualizers";
import type { RGB, VizPalette } from "@/lib/visualizers/types";

/** Renders any CSS color string (oklch(), rgb(), ...) to an RGB triplet by letting the
 * browser's own color parser do the work, via a throwaway 1x1 canvas — the visualizers only
 * deal in RGB, but `--dynamic` (the per-track accent, see lib/colors.ts) can be either format
 * depending on whether it came from a sampled image or the hash fallback. */
function cssColorToRgb(css: string, probe: CanvasRenderingContext2D): RGB | null {
  probe.fillStyle = "#000";
  try {
    probe.fillStyle = css;
  } catch {
    return null;
  }
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}

function rgbToHue([r, g, b]: RGB): number {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  switch (max) {
    case rf:
      h = ((gf - bf) / d) % 6;
      break;
    case gf:
      h = (bf - rf) / d + 2;
      break;
    default:
      h = (rf - gf) / d + 4;
      break;
  }
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: RGB;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

/** Builds the two-tone visualizer palette from the current track's hue alone — lightness and
 * saturation are normalised per theme rather than taken from the sampled artwork color, so a
 * pale or dark piece of art can't wash the visualizer out or muddy it. Dark mode wants a
 * bright, saturated tone for additive ("lighter") blending against a near-black bed; light
 * mode wants a noticeably darker (but still saturated) tone so it actually reads against a
 * near-white bed under normal ("source-over") blending instead of disappearing into it. */
function paletteFromHue(hue: number, isDark: boolean) {
  const accent = hslToRgb(hue, 0.7, isDark ? 0.66 : 0.44);
  const accent2 = hslToRgb((hue + 28) % 360, 0.62, isDark ? 0.8 : 0.58);
  const ink: RGB = isDark ? [250, 240, 230] : [38, 28, 22];
  return { accent, accent2, ink };
}

const FALLBACK_RGB: RGB = [226, 104, 44];

/**
 * Full-bleed canvas that renders the currently selected visualizer behind the full-screen
 * player's chrome. Colour comes from `--dynamic` (the same per-track accent the rest of the
 * app already themes around, see lib/colors.ts) so the visualizer matches the art without any
 * palette of its own to keep in sync, and re-reads it whenever the track or theme changes.
 */
export function VisualizerStage({
  featuresRef,
  styleId,
}: {
  featuresRef: React.RefObject<AudioFeatures>;
  styleId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const instance = getVisualizer(styleId).create();
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const palette: VizPalette = { accent: FALLBACK_RGB, accent2: FALLBACK_RGB, ink: [250, 240, 230], isDark: true };

    let w = 0;
    let h = 0;
    const readPalette = () => {
      // musicflow is dark by default (:root) with a `.light` class override, the opposite of
      // Tailwind's usual `.dark` convention — see styles.css.
      palette.isDark = !document.documentElement.classList.contains("light");
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--dynamic").trim();
      const rgb = raw && probe ? cssColorToRgb(raw, probe) : null;
      const { accent, accent2, ink } = paletteFromHue(rgb ? rgbToHue(rgb) : 28, palette.isDark);
      palette.accent = accent;
      palette.accent2 = accent2;
      palette.ink = ink;
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      instance.resize?.(w, h);
    };

    readPalette();
    resize();
    window.addEventListener("resize", resize);
    // Watches both the theme toggle (a `class` change) and track changes (`--dynamic` is
    // written as an inline `style` property, see applyDynamicColor in lib/colors.ts).
    const observer = new MutationObserver(readPalette);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      instance.draw({ ctx, w, h, dt, f: featuresRef.current, palette });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, [featuresRef, styleId]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
