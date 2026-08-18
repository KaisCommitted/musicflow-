import { useEffect, useRef } from "react";
import { getAudioElement, usePlayer } from "@/store/player";
import { getAnalyser } from "@/lib/audioAnalyser";
import { type NowPlayingEnergy } from "@/store/library";
import { cn } from "@/lib/utils";

/** Per-level tuning for how hard the artwork reacts. `beatMultiplier` is how far bass has to
 * spike above its own rolling average to count as a beat (lower = fires more readily);
 * everything else scales how big that beat (and the ambient loudness underneath it) reads
 * visually. Three levels for now — Settings exposes exactly these, nothing hidden beyond them,
 * so adding a level later just means adding a key here. */
const PRESETS: Record<
  NowPlayingEnergy,
  {
    beatMultiplier: number;
    decay: number;
    avgSmoothing: number;
    scaleAmt: number;
    haloOpacityBase: number;
    haloOpacityAmt: number;
    haloScaleAmt: number;
  }
> = {
  calm: {
    beatMultiplier: 1.35,
    decay: 0.9,
    avgSmoothing: 0.08,
    scaleAmt: 0.03,
    haloOpacityBase: 0.1,
    haloOpacityAmt: 0.22,
    haloScaleAmt: 0.3,
  },
  balanced: {
    beatMultiplier: 1.22,
    decay: 0.87,
    avgSmoothing: 0.06,
    scaleAmt: 0.055,
    haloOpacityBase: 0.14,
    haloOpacityAmt: 0.34,
    haloScaleAmt: 0.5,
  },
  energetic: {
    beatMultiplier: 1.12,
    decay: 0.84,
    avgSmoothing: 0.045,
    scaleAmt: 0.09,
    haloOpacityBase: 0.18,
    haloOpacityAmt: 0.48,
    haloScaleAmt: 0.75,
  },
};

/** Wraps the full-screen player's album art with a real audio-reactive presence: a soft color
 * halo bleeding out into the open space around it, plus a scale pop on the art itself, both
 * driven frame-by-frame off the shared AnalyserNode — not a decorative CSS loop. A "beat" is
 * bass energy spiking above its own recent rolling average (so it adapts to the track instead
 * of a fixed loudness threshold that'd never fire on a quiet song or would fire constantly on a
 * loud one); each beat sets a pulse that decays like a VU meter's peak hold. Ambient loudness
 * (RMS of the time-domain signal) drives a gentler, continuous component underneath that so
 * there's still some life between hits. Colored via --dynamic, the same per-song accent the
 * rest of the UI already themes around, so it's correct in both light and dark without any
 * theme branching here.
 *
 * The scale/glow are applied to this component's own wrapper via direct style mutation in a
 * rAF loop — deliberately not going through the framer-motion element that crossfades the art
 * between songs (children), since driving the same DOM node's transform from two different
 * places would fight every frame. Only runs while actually playing; stops and resets on pause
 * or unmount so it costs nothing the rest of the time. */
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
    };

    const node = audio && getAnalyser(audio);
    if (!isPlaying || !node) {
      reset();
      return;
    }

    const preset = PRESETS[energy];
    const freq = new Uint8Array(node.frequencyBinCount);
    const time = new Uint8Array(node.fftSize);
    // Only the low ~12% of bins — isolates kick/bass energy instead of averaging it away
    // against mids and highs, which is what actually makes a "beat" detectable at all.
    const bassEnd = Math.max(1, Math.floor(freq.length * 0.12));
    let raf = 0;
    let bassAvg = 0;
    let pulse = 0;
    let lastBeat = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
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

      const scale = 1 + pulse * preset.scaleAmt + overall * preset.scaleAmt * 0.3;
      stage.style.transform = `scale(${scale.toFixed(4)})`;
      const glowBlur = 40 + pulse * 60 + overall * 30;
      const glowSpread = pulse * 6;
      const glowAlpha = Math.min(1, 0.35 + pulse * 0.4 + overall * 0.15);
      stage.style.boxShadow =
        `0 0 ${glowBlur.toFixed(0)}px ${glowSpread.toFixed(0)}px ` +
        `color-mix(in oklab, var(--dynamic) ${Math.round(glowAlpha * 100)}%, transparent)`;

      halo.style.opacity = Math.min(
        1,
        preset.haloOpacityBase + overall * preset.haloOpacityAmt + pulse * preset.haloOpacityAmt,
      ).toFixed(3);
      halo.style.transform = `scale(${(1 + overall * preset.haloScaleAmt * 0.6 + pulse * preset.haloScaleAmt).toFixed(4)})`;
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
      <div
        ref={haloRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 scale-100 rounded-full opacity-0 blur-3xl"
        style={{ backgroundColor: "var(--dynamic)" }}
      />
      <div ref={stageRef} className="h-full w-full rounded-3xl">
        {children}
      </div>
    </div>
  );
}
