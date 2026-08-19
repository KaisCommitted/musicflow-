import { clamp01, mix, rgba, type VizFrame, type Visualizer } from "./types";

/**
 * "Pulse" — the energetic option. A radial spectrum corona around the artwork,
 * beat-thrown particles and a reactive vignette.
 */

type P = { a: number; r: number; v: number; life: number; ttl: number; size: number };

export const pulse: Visualizer = {
  id: "pulse",
  name: "Pulse",
  description: "Radial spectrum corona with beat-thrown particles.",
  create() {
    const parts: P[] = [];
    const bars = 96;
    const smoothed = new Float32Array(bars);

    return {
      draw({ ctx, w, h, dt, f, palette }: VizFrame) {
        const { accent, accent2, isDark } = palette;
        const cx = w / 2;
        const cy = h / 2;
        const base = Math.min(w, h) * 0.235;

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";

        // ambient bed so it is never empty
        const bg = ctx.createRadialGradient(cx, cy, base * 0.5, cx, cy, Math.max(w, h) * 0.75);
        bg.addColorStop(0, rgba(accent, (isDark ? 0.22 : 0.16) * (0.35 + f.level)));
        bg.addColorStop(1, rgba(accent2, 0));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // ---- corona ---------------------------------------------------------
        const spec = f.spectrum;
        const k = 1 - Math.exp(-dt * 12);
        ctx.lineCap = "round";
        for (let i = 0; i < bars; i++) {
          const t = i / bars;
          // mirror the spectrum so both halves match
          const si = Math.floor((t < 0.5 ? t * 2 : (1 - t) * 2) * (spec.length - 1));
          const target = spec[si] ?? 0;
          smoothed[i] = smoothed[i]! + (target - smoothed[i]!) * k;
          const v = smoothed[i]!;
          const ang = t * Math.PI * 2 - Math.PI / 2 + f.time * 0.06;
          const inner = base * (1.12 + f.bass * 0.05);
          const len = Math.min(w, h) * (0.02 + v * 0.19 + f.beat * 0.012);
          const x1 = cx + Math.cos(ang) * inner;
          const y1 = cy + Math.sin(ang) * inner;
          const x2 = cx + Math.cos(ang) * (inner + len);
          const y2 = cy + Math.sin(ang) * (inner + len);
          ctx.strokeStyle = rgba(
            mix(accent, accent2, clamp01(v * 1.4)),
            (isDark ? 0.55 : 0.4) * (0.2 + v * 1.1),
          );
          ctx.lineWidth = 2 + v * 3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // ---- beat particles --------------------------------------------------
        if (f.beat > 0.6 && f.active) {
          const n = Math.round(6 + f.beat * 16);
          for (let i = 0; i < n && parts.length < 260; i++) {
            parts.push({
              a: Math.random() * Math.PI * 2,
              r: base * 1.2,
              v: 90 + Math.random() * 320 * f.beat,
              life: 0,
              ttl: 1.1 + Math.random() * 1.4,
              size: 1 + Math.random() * 2.4,
            });
          }
        }
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]!;
          p.life += dt;
          p.v *= Math.exp(-dt * 1.1);
          p.r += p.v * dt;
          p.a += dt * 0.12;
          const a = Math.max(0, 1 - p.life / p.ttl) ** 1.6 * (isDark ? 0.7 : 0.45);
          if (a <= 0.003) {
            parts.splice(i, 1);
            continue;
          }
          ctx.fillStyle = rgba(accent2, a);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(p.a) * p.r, cy + Math.sin(p.a) * p.r, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
};
