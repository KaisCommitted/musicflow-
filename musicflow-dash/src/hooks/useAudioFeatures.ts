import { useEffect, useRef } from "react";
import { createFeatures, FeatureExtractor, type AudioFeatures } from "@/lib/audio/features";
import { getAnalyser } from "@/lib/audioAnalyser";
import { getAudioElement, usePlayer } from "@/store/player";

/**
 * Owns the rAF loop that keeps a live `AudioFeatures` ref up to date for the full-screen
 * visualizer, tapping the app's one shared <audio> element through a Web Audio AnalyserNode.
 * Pass `enabled` so this only taps the element and runs its loop while the full-screen player
 * is actually mounted — it costs nothing otherwise.
 */
export function useAudioFeatures(enabled: boolean): React.RefObject<AudioFeatures> {
  const featuresRef = useRef<AudioFeatures>(createFeatures());
  const extractorRef = useRef<FeatureExtractor | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (!extractorRef.current) {
      const audio = getAudioElement();
      const analyser = audio ? getAnalyser(audio) : null;
      if (analyser) extractorRef.current = new FeatureExtractor(analyser);
    }

    let raf = 0;
    let last = performance.now();
    // The FFT extraction below doesn't need to run at full display refresh (120Hz+ panels were
    // doing this work twice as often as a 60Hz one for no visible benefit) — accumulate real
    // elapsed time and only do the work once ~33ms (30fps) has piled up, while dt still reflects
    // however much time actually passed so motion stays frame-rate independent.
    let acc = 0;
    const STEP = 1 / 30;
    const loop = (now: number) => {
      const frameDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += frameDt;
      if (acc >= STEP) {
        const dt = acc;
        acc = 0;
        const ex = extractorRef.current;
        if (ex) ex.update(featuresRef.current, dt, usePlayer.getState().isPlaying);
        else {
          featuresRef.current.time += dt;
          featuresRef.current.active = false;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return featuresRef;
}
