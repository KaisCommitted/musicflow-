import { clamp01, mix, rgba, type VizFrame, type Visualizer } from "./types";

/**
 * "Drift" — the calm option. Two slow gradient washes and a single breathing
 * halo. It still tracks the music, but only through very slow envelopes, so
 * nothing ever snaps.
 */
export const drift: Visualizer = {
  id: "drift",
  name: "Drift",
  description: "Calm, slow-moving washes of light. Barely-there reaction.",
  create() {
    let smooth = 0;

    return {
      draw({ ctx, w, h, dt, f, palette }: VizFrame) {
        const { accent, accent2, isDark } = palette;
        smooth += (clamp01(f.level * 1.1) - smooth) * (1 - Math.exp(-dt * 0.9));

        ctx.clearRect(0, 0, w, h);
        // "multiply" in light mode, not "source-over" — see ember.ts for why (additive/normal
        // layering on a light bed washes toward flat white instead of reading as colour).
        ctx.globalCompositeOperation = isDark ? "lighter" : "multiply";

        const t = f.time * 0.05;
        const layers = [
          { c: accent, sx: 0.32, sy: 0.36, sp: 1, r: 0.85 },
          { c: mix(accent, accent2, 0.7), sx: 0.7, sy: 0.62, sp: -0.7, r: 0.95 },
          { c: accent2, sx: 0.55, sy: 0.2, sp: 0.45, r: 0.65 },
        ];

        for (const l of layers) {
          const x = (l.sx + Math.cos(t * l.sp) * 0.12) * w;
          const y = (l.sy + Math.sin(t * l.sp * 1.3) * 0.1) * h;
          const r = Math.min(w, h) * l.r * (1 + smooth * 0.16);
          const a = (isDark ? 0.2 : 0.36) * (0.5 + smooth * 0.7);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(l.c, a));
          g.addColorStop(1, rgba(l.c, 0));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }

        const cx = w / 2;
        const cy = h / 2;
        const haloR = Math.min(w, h) * (0.3 + smooth * 0.06 + Math.sin(f.time * 0.6) * 0.01);
        const hg = ctx.createRadialGradient(cx, cy, haloR * 0.2, cx, cy, haloR);
        hg.addColorStop(0, rgba(accent, (isDark ? 0.3 : 0.42) * (0.4 + smooth * 0.6)));
        hg.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
};
