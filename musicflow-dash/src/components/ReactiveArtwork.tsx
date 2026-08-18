import { useEffect, useRef } from "react";
import { getAudioElement, usePlayer } from "@/store/player";
import { getAnalyser } from "@/lib/audioAnalyser";
import { type NowPlayingEnergy } from "@/store/library";
import { cn } from "@/lib/utils";

/** CSS-pixel size of the aura's own canvas — deliberately bigger than the art it surrounds
 * (see the `inner`/bar-length numbers below) so the ring of bars has room to radiate out into
 * the open space around the art, without a prop for every caller to have to think about. */
const CANVAS_SIZE = 620;

/** freq[] bins to skip entirely — bin 0 (and the couple next to it) carry DC/near-DC energy
 * that reads as a single wildly-oversized spike unrelated to anything audible, which is
 * exactly what made an earlier version of this look broken (one huge bar, everything else
 * flat) rather than like a real spectrum. */
const BIN_OFFSET = 2;

/** Per-level tuning. The aura is a ring of thin bars around the art — one bar per frequency
 * bin, each bar's length its own smoothed bin energy — slowly rotating for a sense of
 * continuous flow, with every bar getting an extra outward kick on each detected beat.
 * - `envSmoothing`: envelope-follower rate applied to every bar's raw reading before it's
 *   drawn. Raw analyser data is noisy frame to frame (Web Audio doesn't smooth time-domain
 *   data at all, and its frequency-data smoothing alone isn't enough either) — skipping this
 *   is what made an earlier version of this effect look like flicker instead of motion.
 * - `beatMultiplier`: how far bass has to spike above its own slow rolling average to count as
 *   a beat (lower = fires more readily).
 * - `inner`/`maxBarLength`/`ambientAmt`/`pulseAmt`::the bar ring's geometry — inner radius, how
 *   far a bar's own bin energy can push it out, how much ambient loudness adds on top, and how
 *   big the shared kick is when a beat fires. Worst case (all maxed at once) is kept comfortably
 *   under CANVAS_SIZE/2, with a hard clamp in the draw loop as a backstop.
 * - `rotationSpeed`: radians/sec the whole ring slowly turns — real audio doesn't have a sense
 *   of "flow" on its own (each bin is just a number), so this is a presentation choice, not
 *   synthesized data: every bar's length is still 100% live audio, only its position drifts. */
const PRESETS: Record<
  NowPlayingEnergy,
  {
    bars: number;
    envSmoothing: number;
    beatMultiplier: number;
    decay: number;
    avgSmoothing: number;
    inner: number;
    maxBarLength: number;
    ambientAmt: number;
    pulseAmt: number;
    rotationSpeed: number;
    baseAlpha: number;
    scaleAmt: number;
  }
> = {
  calm: {
    bars: 64,
    envSmoothing: 0.09,
    beatMultiplier: 1.35,
    decay: 0.93,
    avgSmoothing: 0.05,
    inner: 158,
    maxBarLength: 60,
    ambientAmt: 14,
    pulseAmt: 22,
    rotationSpeed: 0.03,
    baseAlpha: 0.5,
    scaleAmt: 0.015,
  },
  balanced: {
    bars: 90,
    envSmoothing: 0.15,
    beatMultiplier: 1.22,
    decay: 0.9,
    avgSmoothing: 0.045,
    inner: 158,
    maxBarLength: 95,
    ambientAmt: 20,
    pulseAmt: 36,
    rotationSpeed: 0.06,
    baseAlpha: 0.62,
    scaleAmt: 0.03,
  },
  energetic: {
    bars: 120,
    envSmoothing: 0.22,
    beatMultiplier: 1.12,
    decay: 0.87,
    avgSmoothing: 0.04,
    inner: 158,
    maxBarLength: 115,
    ambientAmt: 25,
    pulseAmt: 48,
    rotationSpeed: 0.11,
    baseAlpha: 0.75,
    scaleAmt: 0.05,
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wraps the full-screen player's album art with a real audio-reactive aura: a ring of thin
 * bars radiating out from behind the art, one bar per frequency bin, each bar's own length its
 * own smoothed bin energy — a real spiky, textured silhouette, not a vague glow. The whole ring
 * turns slowly for a sense of flow, and every beat gives it a shared outward kick that decays
 * like a VU meter's peak hold. Colored via --dynamic, the same per-song accent the rest of the
 * UI already themes around, so it's correct in both light and dark without theme branching here.
 *
 * Drawn on its own <canvas> (not CSS) — a real bar-per-bin ring needs real per-element geometry
 * that CSS has no cheap way to express, and canvas is also just faster for ~100 redrawn
 * segments every frame. The art's own subtle scale pulse is still applied via direct style
 * mutation on a separate wrapper, deliberately not the framer-motion element that crossfades
 * the art between songs (children) — driving the same DOM node's transform from two places
 * would fight every frame.
 *
 * Only runs while actually playing; stops and resets on pause or unmount so it costs nothing
 * the rest of the time (and, like any rAF work, the browser itself pauses the loop whenever the
 * window isn't visible). */
export function ReactiveArtwork({
  energy,
  className,
  children,
}: {
  energy: NowPlayingEnergy;
  className?: string;
  children: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const songId = usePlayer((s) => s.current()?.id);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const audio = getAudioElement();
    const ctx2d = canvas?.getContext("2d");
    if (!stage || !canvas || !ctx2d) return;

    const reset = () => {
      stage.style.transform = "";
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    };

    const node = audio && getAnalyser(audio);
    if (!isPlaying || !node) {
      reset();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
    ctx2d.scale(dpr, dpr);

    // Re-read per song (not per frame — getComputedStyle forces a style recalc) so the aura
    // tracks the per-track dynamic accent color the rest of the UI already themes around.
    const color =
      getComputedStyle(document.documentElement).getPropertyValue("--dynamic").trim() ||
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();

    const preset = PRESETS[energy];
    const freq = new Uint8Array(node.frequencyBinCount);
    const time = new Uint8Array(node.fftSize);
    // Most of a track's energy sits in the lower ~75% of bins — the rest is near-silent for
    // most music and would just draw a ring of flat, lifeless bars.
    const usableBins = Math.floor(freq.length * 0.75) - BIN_OFFSET;
    const bassEnd = Math.max(1, Math.floor(freq.length * 0.12));
    const maxOuter = CANVAS_SIZE / 2 - 8;
    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;

    // Precomputed once per song, not per frame: which bin range each bar averages over. Real
    // music's energy is heavily bass-weighted, so a *linear* bin-per-bar mapping leaves the
    // first couple of bars towering over a mostly-flat rest of the ring — this curves the
    // mapping so low/mid frequencies (where the actual variation is) get spread across more
    // bars instead of being crushed into the first two or three.
    const n = preset.bars;
    const binBounds: number[] = [];
    for (let i = 0; i <= n; i++) {
      binBounds.push(BIN_OFFSET + Math.floor(Math.pow(i / n, 1.8) * usableBins));
    }

    const barEnv = new Float32Array(preset.bars);
    let raf = 0;
    let bassAvg = 0;
    let pulse = 0;
    let lastBeat = 0;
    let rotation = 0;
    let lastT = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!lastT) lastT = t;
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      node.getByteFrequencyData(freq);
      node.getByteTimeDomainData(time);

      let bassSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += freq[i] ?? 0;
      const bass = bassSum / bassEnd / 255;

      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = ((time[i] ?? 128) - 128) / 128;
        sumSq += v * v;
      }
      const overall = Math.min(1, Math.sqrt(sumSq / time.length) * 1.8);

      bassAvg += (bass - bassAvg) * preset.avgSmoothing;
      // The floor (bass > 0.12) keeps near-silence from "spiking" relative to a near-zero
      // average; the cooldown (220ms) keeps one kick's decay tail from re-triggering itself.
      if (bass > bassAvg * preset.beatMultiplier && bass > 0.12 && t - lastBeat > 220) {
        pulse = 1;
        lastBeat = t;
      }
      pulse *= preset.decay;
      rotation += preset.rotationSpeed * dt;

      stage.style.transform =
        `scale(${(1 + pulse * preset.scaleAmt + overall * preset.scaleAmt * 0.3).toFixed(4)})`;

      ctx2d.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx2d.save();
      ctx2d.translate(cx, cy);
      ctx2d.rotate(rotation);
      ctx2d.lineCap = "round";

      const path = new Path2D();
      for (let i = 0; i < n; i++) {
        // Average over this bar's whole bin window (not a single sampled bin) — a lot smoother
        // bar-to-bar, and far less prone to one noisy bin spiking on its own.
        const lo = binBounds[i]!;
        const hi = Math.max(lo + 1, binBounds[i + 1]!);
        let sum = 0;
        for (let b = lo; b < hi; b++) sum += freq[b] ?? 0;
        const raw = sum / (hi - lo) / 255;
        // Gamma-compresses the amplitude (same idea as a dB scale on a real spectrum analyzer)
        // so quiet bars still visibly move instead of every bar but the loudest handful
        // reading as flat — raw linear amplitude makes almost the whole ring look dead.
        const compressed = Math.pow(raw, 0.6);
        const env = barEnv[i]! + (compressed - barEnv[i]!) * preset.envSmoothing;
        barEnv[i] = env;
        const len = env * preset.maxBarLength + overall * preset.ambientAmt + pulse * preset.pulseAmt;
        const outer = Math.min(preset.inner + Math.max(4, len), maxOuter);
        const angle = (i / n) * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        path.moveTo(cosA * preset.inner, sinA * preset.inner);
        path.lineTo(cosA * outer, sinA * outer);
      }

      // Two passes over the same path: a soft blurred glow, then a crisp pass on top — cheaper
      // than giving each of ~100 bars its own shadow, and reads as "glowing bars" either way.
      const glowAlpha = clamp(preset.baseAlpha * 0.55 + pulse * 0.3, 0, 1);
      ctx2d.shadowColor = color;
      ctx2d.shadowBlur = 26 + pulse * 28;
      ctx2d.strokeStyle = `color-mix(in oklab, ${color} ${Math.round(glowAlpha * 100)}%, transparent)`;
      ctx2d.lineWidth = 9;
      ctx2d.stroke(path);

      const detailAlpha = clamp(preset.baseAlpha * 0.85 + pulse * 0.25, 0, 1);
      ctx2d.shadowBlur = 0;
      ctx2d.strokeStyle = `color-mix(in oklab, ${color} ${Math.round(detailAlpha * 100)}%, transparent)`;
      ctx2d.lineWidth = 3.2;
      ctx2d.stroke(path);

      ctx2d.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      reset();
    };
  }, [isPlaying, songId, energy]);

  return (
    <div className={cn("relative", className)}>
      {/* Sized and centered off its own fixed CANVAS_SIZE, independent of the art's own size —
          absolute positioning takes it out of layout, so it doesn't push the title/controls
          below it. Painted before `stage` below, so it sits behind the art in the default
          stacking order — a negative z-index here would instead escape to the nearest ancestor
          that establishes its own stacking context (the full-screen player's fixed/z-50 root),
          landing behind that view's own background-blur overlay and never showing at all. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
      />
      <div ref={stageRef} className="relative h-full w-full rounded-3xl">
        {children}
      </div>
    </div>
  );
}
