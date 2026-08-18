import { useEffect, useRef } from "react";
import { getAudioElement, usePlayer } from "@/store/player";
import { getAnalyser } from "@/lib/audioAnalyser";
import { type NowPlayingEnergy } from "@/store/library";
import { cn } from "@/lib/utils";

/** Neutral, roughly-circular starting shape for the halo — close enough to a circle that it
 * doesn't read as "broken" before the first frame lands, but already faintly organic so there's
 * no visible snap once real audio data takes over. */
const DEFAULT_BLOB = "46% 54% 52% 48% / 48% 46% 54% 52%";

/** Per-level tuning for how hard the artwork reacts.
 * - `envSmoothing` is the envelope-follower rate applied to every raw analyser reading before
 *   it touches anything visual — this is what keeps the effect from looking like noise. Web
 *   Audio never smooths time-domain data itself, and even frequency data (which the AnalyserNode
 *   does smooth a little) still varies enough frame-to-frame to look shaky without this.
 * - `beatMultiplier` is how far bass has to spike above its own slow rolling average to count
 *   as a beat (lower = fires more readily).
 * - `blobAmt` is how far each corner of the halo can bulge from a perfect circle, in percentage
 *   points — this is the "shape changes with the beat" part, not just size/opacity.
 * - everything else scales how big a beat (and the ambient loudness underneath it) reads
 *   visually. Three levels for now — Settings exposes exactly these, nothing hidden beyond
 *   them, so adding a level later just means adding a key here. */
const PRESETS: Record<
  NowPlayingEnergy,
  {
    envSmoothing: number;
    beatMultiplier: number;
    decay: number;
    avgSmoothing: number;
    scaleAmt: number;
    haloOpacityBase: number;
    haloOpacityAmt: number;
    haloScaleAmt: number;
    blobAmt: number;
  }
> = {
  calm: {
    envSmoothing: 0.09,
    beatMultiplier: 1.35,
    decay: 0.93,
    avgSmoothing: 0.05,
    scaleAmt: 0.02,
    haloOpacityBase: 0.18,
    haloOpacityAmt: 0.2,
    haloScaleAmt: 0.28,
    blobAmt: 9,
  },
  balanced: {
    envSmoothing: 0.14,
    beatMultiplier: 1.22,
    decay: 0.9,
    avgSmoothing: 0.045,
    scaleAmt: 0.04,
    haloOpacityBase: 0.24,
    haloOpacityAmt: 0.3,
    haloScaleAmt: 0.46,
    blobAmt: 15,
  },
  energetic: {
    envSmoothing: 0.2,
    beatMultiplier: 1.12,
    decay: 0.87,
    avgSmoothing: 0.04,
    scaleAmt: 0.065,
    haloOpacityBase: 0.3,
    haloOpacityAmt: 0.4,
    haloScaleAmt: 0.68,
    blobAmt: 22,
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wraps the full-screen player's album art with a real audio-reactive presence: a soft color
 * aura bleeding out into the open space around it, plus a scale pop on the art itself, both
 * driven frame-by-frame off the shared AnalyserNode — not a decorative CSS loop. The aura isn't
 * just a circle that grows and shrinks: its four corners deform independently off bass/mid/
 * treble energy (plus a kick from every beat), so its actual silhouette changes shape with the
 * music, not just size. A "beat" is bass energy spiking above its own recent rolling average
 * (so it adapts to the track instead of a fixed loudness threshold that'd never fire on a quiet
 * song or would fire constantly on a loud one); each beat sets a pulse that decays like a VU
 * meter's peak hold. Colored via --dynamic, the same per-song accent the rest of the UI already
 * themes around, so it's correct in both light and dark without any theme branching here.
 *
 * Every raw analyser reading passes through an envelope follower (see `envSmoothing`) before it
 * drives anything visual. Skipping this is what made an earlier version of this effect look
 * like shaky flicker instead of smooth motion — raw per-frame audio data is noisy (Web Audio
 * doesn't smooth time-domain data at all, and even its own frequency-data smoothing isn't
 * enough on its own), and animating directly off it reads as jitter, not "alive".
 *
 * The scale/glow are applied to this component's own wrapper via direct style mutation in a
 * rAF loop — deliberately not going through the framer-motion element that crossfades the art
 * between songs (children), since driving the same DOM node's transform from two different
 * places would fight every frame. Only runs while actually playing; stops and resets on pause
 * or unmount so it costs nothing the rest of the time (and, like any rAF work, the browser
 * itself pauses the loop whenever the window isn't visible). */
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
  const haloRef = useRef<HTMLDivElement>(null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const songId = usePlayer((s) => s.current()?.id);

  useEffect(() => {
    const stage = stageRef.current;
    const halo = haloRef.current;
    const audio = getAudioElement();
    if (!stage || !halo) return;

    const reset = () => {
      stage.style.transform = "";
      stage.style.boxShadow = "";
      halo.style.opacity = "0";
      halo.style.transform = "scale(1)";
      halo.style.borderRadius = DEFAULT_BLOB;
    };

    const node = audio && getAnalyser(audio);
    if (!isPlaying || !node) {
      reset();
      return;
    }

    const preset = PRESETS[energy];
    const freq = new Uint8Array(node.frequencyBinCount);
    const time = new Uint8Array(node.fftSize);
    // Split into three bands by bin index — isolates kick/bass from mids/highs instead of
    // averaging them all away together, which is what makes both beat detection and the
    // per-corner blob shape possible at all.
    const n = freq.length;
    const bassEnd = Math.max(1, Math.floor(n * 0.12));
    const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.45));

    let raf = 0;
    // Envelope-followed bands — everything visual reads from these, never from a raw
    // per-frame value.
    let bassEnv = 0;
    let midEnv = 0;
    let trebleEnv = 0;
    let overallEnv = 0;
    let bassAvg = 0;
    let pulse = 0;
    let lastBeat = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      node.getByteFrequencyData(freq);
      node.getByteTimeDomainData(time);

      let bassSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += freq[i] ?? 0;
      let midSum = 0;
      for (let i = bassEnd; i < midEnd; i++) midSum += freq[i] ?? 0;
      let trebleSum = 0;
      for (let i = midEnd; i < n; i++) trebleSum += freq[i] ?? 0;
      const bass = bassSum / bassEnd / 255;
      const mid = midSum / (midEnd - bassEnd) / 255;
      const treble = trebleSum / (n - midEnd) / 255;

      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = ((time[i] ?? 128) - 128) / 128;
        sumSq += v * v;
      }
      const overall = Math.min(1, Math.sqrt(sumSq / time.length) * 1.8);

      const k = preset.envSmoothing;
      bassEnv += (bass - bassEnv) * k;
      midEnv += (mid - midEnv) * k;
      trebleEnv += (treble - trebleEnv) * k;
      overallEnv += (overall - overallEnv) * k;
      // Tracks the already-smoothed bassEnv, on a much slower timescale — this is "what bass
      // has looked like recently", the baseline a real spike needs to clear.
      bassAvg += (bassEnv - bassAvg) * preset.avgSmoothing;

      // The floor (bassEnv > 0.12) keeps near-silence from "spiking" relative to a near-zero
      // average; the cooldown (220ms) keeps one kick's decay tail from re-triggering itself.
      if (bassEnv > bassAvg * preset.beatMultiplier && bassEnv > 0.12 && t - lastBeat > 220) {
        pulse = 1;
        lastBeat = t;
      }
      pulse *= preset.decay;

      const scale = 1 + pulse * preset.scaleAmt + overallEnv * preset.scaleAmt * 0.3;
      stage.style.transform = `scale(${scale.toFixed(4)})`;
      const glowBlur = 40 + pulse * 60 + overallEnv * 30;
      const glowSpread = pulse * 6;
      const glowAlpha = clamp(0.35 + pulse * 0.4 + overallEnv * 0.15, 0, 1);
      stage.style.boxShadow =
        `0 0 ${glowBlur.toFixed(0)}px ${glowSpread.toFixed(0)}px ` +
        `color-mix(in oklab, var(--dynamic) ${Math.round(glowAlpha * 100)}%, transparent)`;

      halo.style.opacity = clamp(
        preset.haloOpacityBase + overallEnv * preset.haloOpacityAmt + pulse * preset.haloOpacityAmt,
        0,
        1,
      ).toFixed(3);
      halo.style.transform = `scale(${(1 + overallEnv * preset.haloScaleAmt * 0.6 + pulse * preset.haloScaleAmt).toFixed(4)})`;

      // The aura's actual silhouette: each corner's two radii pull from a different band (plus
      // a shared kick from the beat pulse), all already-smooth envelope values, so the shape
      // drifts and bulges instead of snapping. Crossing bands across corners (rather than one
      // band per corner) keeps it from reading as four mechanically-independent lobes.
      const amt = preset.blobAmt;
      const kick = pulse * amt * 0.7;
      const r = (band: number, phase: number) =>
        clamp(50 + (band - 0.32) * amt + kick * phase, 28, 72).toFixed(1);
      halo.style.borderRadius =
        `${r(bassEnv, 1)}% ${r(midEnv, -1)}% ${r(trebleEnv, 1)}% ${r(overallEnv, -1)}% / ` +
        `${r(trebleEnv, -1)}% ${r(overallEnv, 1)}% ${r(bassEnv, -1)}% ${r(midEnv, 1)}%`;
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      reset();
    };
  }, [isPlaying, songId, energy]);

  return (
    <div className={cn("relative", className)}>
      {/* Painted before `stage` below, so it sits behind the art in the default stacking
          order — a negative z-index here would instead escape to the nearest ancestor that
          establishes its own stacking context (the full-screen player's fixed/z-50 root),
          landing behind that view's own background-blur overlay and never showing at all. */}
      {/* No CSS transition here on purpose — opacity/transform/borderRadius are already
          updated every frame from envelope-smoothed values below, and layering a CSS
          transition on top would just retrigger against a moving target on every frame,
          producing a laggy chase instead of anything smoother. */}
      <div
        ref={haloRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 blur-3xl"
        style={{ backgroundColor: "var(--dynamic)", borderRadius: DEFAULT_BLOB }}
      />
      <div ref={stageRef} className="h-full w-full rounded-3xl">
        {children}
      </div>
    </div>
  );
}
