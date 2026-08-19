import { clamp01, mix, rgba, type RGB, type VizFrame, type Visualizer } from "./types";

/**
 * "Ember" — flowing aurora fields + rising embers + beat bloom rings.
 * Default style: alive but continuous, everything driven by damped features.
 */

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  band: "bass" | "mid" | "treble";
};

type Ring = { r: number; life: number; strength: number };
type Spark = { x: number; y: number; vy: number; vx: number; life: number; size: number };

export const ember: Visualizer = {
  id: "ember",
  name: "Ember",
  description: "Flowing aurora fields with beat blooms and drifting embers.",
  create() {
    let blobs: Blob[] = [];
    const rings: Ring[] = [];
    const sparks: Spark[] = [];
    let seeded = false;
    let sparkBudget = 0;

    const seed = (w: number, h: number) => {
      const bands: Blob["band"][] = ["bass", "mid", "treble", "bass", "mid"];
      blobs = bands.map((band, i) => ({
        x: (0.2 + 0.15 * i) * w,
        y: (0.3 + 0.12 * ((i * 5) % 4)) * h,
        vx: (i % 2 === 0 ? 1 : -1) * (10 + i * 3),
        vy: (i % 3 === 0 ? -1 : 1) * (7 + i * 2),
        r: Math.min(w, h) * (0.32 + 0.07 * (i % 3)),
        phase: i * 1.7,
        band,
      }));
      seeded = true;
    };

    return {
      resize: (w, h) => seed(w, h),
      draw({ ctx, w, h, dt, f, palette }: VizFrame) {
        if (!seeded) seed(w, h);
        const { accent, accent2, ink, isDark } = palette;
        const idle = 1 - clamp01(f.level * 3);
        const drive = clamp01(f.level * 1.15);

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";

        // ---- aurora fields --------------------------------------------------
        for (const b of blobs) {
          const bandVal =
            b.band === "bass" ? f.bass : b.band === "mid" ? f.mid : f.treble;
          b.phase += dt * (0.12 + bandVal * 0.5);
          b.x += b.vx * dt * (0.35 + drive * 0.9);
          b.y += b.vy * dt * (0.35 + drive * 0.9);
          const margin = b.r * 0.5;
          if (b.x < -margin || b.x > w + margin) b.vx *= -1;
          if (b.y < -margin || b.y > h + margin) b.vy *= -1;

          const breathe = 1 + Math.sin(b.phase) * 0.08;
          const r = b.r * breathe * (1 + bandVal * 0.35 + f.beat * 0.06);
          const col: RGB =
            b.band === "bass" ? accent : b.band === "mid" ? mix(accent, accent2, 0.6) : accent2;
          const alpha = (isDark ? 0.26 : 0.2) * (0.32 + bandVal * 0.8 + f.beat * 0.12);

          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
          g.addColorStop(0, rgba(col, alpha));
          g.addColorStop(0.55, rgba(col, alpha * 0.35));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // ---- beat bloom (soft light swell, no hard rings) --------------------
        const cx = w / 2;
        const cy = h / 2;
        if (f.beat > 0.55 && rings.length < 4 && f.active) {
          const last = rings[rings.length - 1];
          if (!last || last.life > 0.18) rings.push({ r: 0, life: 0, strength: f.beat });
        }
        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i]!;
          ring.life += dt;
          ring.r += dt * (240 + ring.strength * 420);
          const a = Math.max(0, 1 - ring.life / 1.4) ** 2 * ring.strength * (isDark ? 0.16 : 0.14);
          if (a <= 0.002) {
            rings.splice(i, 1);
            continue;
          }
          // feathered band instead of a stroked circle — reads as a swell of
          // light rather than an expanding outline
          const inner = Math.max(0, ring.r - 90 - ring.strength * 60);
          const outer = ring.r + 90 + ring.strength * 60;
          const bg = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
          const col = mix(accent, accent2, 0.35);
          bg.addColorStop(0, rgba(col, 0));
          bg.addColorStop(0.5, rgba(col, a));
          bg.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
        }


        // ---- rising embers ---------------------------------------------------
        sparkBudget += dt * (4 + f.treble * 90 + f.beat * 20) * (f.active ? 1 : 0.25);
        while (sparkBudget >= 1 && sparks.length < 160) {
          sparkBudget -= 1;
          sparks.push({
            x: Math.random() * w,
            y: h + 10,
            vy: -(18 + Math.random() * 40) * (0.5 + f.energy),
            vx: (Math.random() - 0.5) * 14,
            life: 0,
            size: 0.7 + Math.random() * 1.9,
          });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]!;
          s.life += dt;
          s.y += s.vy * dt * (0.6 + f.level * 0.9);
          s.x += (s.vx + Math.sin(s.life * 1.4 + s.x * 0.01) * 12) * dt;
          const a = Math.max(0, 1 - s.life / 7) * (isDark ? 0.55 : 0.35);
          if (a <= 0.002 || s.y < -20) {
            sparks.splice(i, 1);
            continue;
          }
          ctx.fillStyle = rgba(mix(accent2, ink, isDark ? 0 : 0.15), a);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size * (1 + f.beat * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }

        // ---- centre halo behind the artwork ---------------------------------
        const haloR = Math.min(w, h) * (0.24 + f.bass * 0.12 + f.beat * 0.03);
        const hg = ctx.createRadialGradient(cx, cy, haloR * 0.25, cx, cy, haloR * 1.9);
        const haloA = (isDark ? 0.4 : 0.26) * (0.35 + f.level * 0.9);
        hg.addColorStop(0, rgba(accent, haloA));
        hg.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR * 1.9, 0, Math.PI * 2);
        ctx.fill();

        // idle veil keeps the screen from ever going flat/empty
        if (idle > 0.01) {
          const t = f.time * 0.06;
          const ix = cx + Math.cos(t) * w * 0.18;
          const iy = cy + Math.sin(t * 0.8) * h * 0.16;
          const ig = ctx.createRadialGradient(ix, iy, 0, ix, iy, Math.min(w, h) * 0.7);
          ig.addColorStop(0, rgba(accent2, idle * (isDark ? 0.12 : 0.09)));
          ig.addColorStop(1, rgba(accent2, 0));
          ctx.fillStyle = ig;
          ctx.fillRect(0, 0, w, h);
        }

        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
};
