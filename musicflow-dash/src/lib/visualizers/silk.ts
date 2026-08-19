import { clamp01, mix, rgba, type VizFrame, type Visualizer } from "./types";

/**
 * "Silk" — flowing horizontal ribbons of light. Each ribbon is a travelling
 * wave whose amplitude is driven by one slice of the spectrum, so the whole
 * screen behaves like a sheet of fabric rippling with the track. Calmer than
 * Pulse, but never static.
 */
export const silk: Visualizer = {
  id: "silk",
  name: "Silk",
  description: "Flowing ribbons of light that ripple with the spectrum.",
  create() {
    const RIBBONS = 7;
    const amps = new Float32Array(RIBBONS);
    let phase = 0;
    let drive = 0;

    return {
      draw({ ctx, w, h, dt, f, palette }: VizFrame) {
        const { accent, accent2, isDark } = palette;
        const spec = f.spectrum;
        drive += (clamp01(f.level * 1.2) - drive) * (1 - Math.exp(-dt * 3));
        phase += dt * (0.35 + drive * 1.1);

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";

        // soft bed so the screen is never flat
        const bed = ctx.createLinearGradient(0, 0, w, h);
        bed.addColorStop(0, rgba(accent, (isDark ? 0.14 : 0.1) * (0.4 + drive)));
        bed.addColorStop(1, rgba(accent2, (isDark ? 0.1 : 0.07) * (0.3 + drive)));
        ctx.fillStyle = bed;
        ctx.fillRect(0, 0, w, h);

        const k = 1 - Math.exp(-dt * 6);
        for (let r = 0; r < RIBBONS; r++) {
          const t = r / (RIBBONS - 1);
          const si = Math.floor(t * (spec.length - 1) * 0.55);
          const target = spec[si] ?? 0;
          amps[r] = amps[r]! + (target - amps[r]!) * k;
          const a = amps[r]!;

          const baseY = h * (0.16 + t * 0.68);
          const amp = h * (0.02 + a * 0.13 + f.beat * 0.008);
          const freq = 1.1 + t * 1.9;
          const speed = phase * (0.6 + t * 0.7) * (r % 2 === 0 ? 1 : -1);
          const col = mix(accent, accent2, t);
          const alpha = (isDark ? 0.4 : 0.3) * (0.22 + a * 1.1 + drive * 0.25);

          ctx.beginPath();
          const steps = 48;
          for (let i = 0; i <= steps; i++) {
            const x = (i / steps) * w;
            const u = (i / steps) * Math.PI * 2 * freq + speed;
            const y =
              baseY +
              Math.sin(u) * amp +
              Math.sin(u * 0.53 + phase * 0.8) * amp * 0.45 +
              Math.cos(u * 2.1 - phase * 0.4) * amp * 0.18;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(col, alpha);
          ctx.lineWidth = 1.2 + a * 5 + drive * 1.5;
          ctx.lineCap = "round";
          ctx.stroke();

          // faint mirrored echo, a touch behind
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const x = (i / steps) * w;
            const u = (i / steps) * Math.PI * 2 * freq + speed * 0.86;
            const y = baseY + 10 + Math.sin(u + 0.5) * amp * 0.7;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(col, alpha * 0.35);
          ctx.lineWidth = 1 + a * 2;
          ctx.stroke();
        }

        // centre bloom that swells with the low end, no hard edges
        const cx = w / 2;
        const cy = h / 2;
        const rad = Math.min(w, h) * (0.3 + f.bass * 0.14);
        const g = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
        g.addColorStop(0, rgba(accent, (isDark ? 0.3 : 0.2) * (0.3 + f.level * 0.9)));
        g.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
};
