/**
 * Audio feature extraction.
 *
 * Turns raw AnalyserNode data into a small, *smooth* set of numbers that the
 * visualizers consume. Everything is heavily damped so motion reads as
 * continuous rather than jittery, and beat detection uses an adaptive
 * threshold against a running average instead of a fixed cut-off.
 */

export type AudioFeatures = {
  /** overall loudness 0..1 (smoothed) */
  level: number;
  /** band energies 0..1 (smoothed) */
  bass: number;
  mid: number;
  treble: number;
  /** beat impulse 0..1 — spikes on a transient, decays smoothly */
  beat: number;
  /** slow-moving energy of the section 0..1 */
  energy: number;
  /** normalised spectrum, 64 bins, smoothed per-bin */
  spectrum: Float32Array;
  /** true while audio is actually playing */
  active: boolean;
  /** seconds since mount, monotonic */
  time: number;
};

export function createFeatures(): AudioFeatures {
  return {
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0,
    energy: 0,
    spectrum: new Float32Array(64),
    active: false,
    time: 0,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class FeatureExtractor {
  private freq: Uint8Array;
  private history: number[] = [];
  private beatCooldown = 0;

  constructor(private analyser: AnalyserNode) {
    this.freq = new Uint8Array(analyser.frequencyBinCount);
  }

  /**
   * @param dt seconds since last update
   * @param active whether the source is currently playing
   */
  update(out: AudioFeatures, dt: number, active: boolean) {
    out.time += dt;
    out.active = active;

    // frame-rate independent smoothing factors
    const fast = 1 - Math.exp(-dt * 14);
    const slow = 1 - Math.exp(-dt * 2.2);
    const glacial = 1 - Math.exp(-dt * 0.35);

    if (!active) {
      out.level = lerp(out.level, 0, slow);
      out.bass = lerp(out.bass, 0, slow);
      out.mid = lerp(out.mid, 0, slow);
      out.treble = lerp(out.treble, 0, slow);
      out.energy = lerp(out.energy, 0, glacial);
      out.beat = lerp(out.beat, 0, fast);
      for (let i = 0; i < out.spectrum.length; i++) {
        out.spectrum[i] = lerp(out.spectrum[i]!, 0, slow);
      }
      return;
    }

    this.analyser.getByteFrequencyData(this.freq as unknown as Uint8Array<ArrayBuffer>);
    const bins = this.freq.length;

    const bandAvg = (from: number, to: number) => {
      let sum = 0;
      const a = Math.floor(bins * from);
      const b = Math.max(a + 1, Math.floor(bins * to));
      for (let i = a; i < b; i++) sum += this.freq[i]!;
      return sum / (b - a) / 255;
    };

    const bass = bandAvg(0, 0.06);
    const mid = bandAvg(0.06, 0.28);
    const treble = bandAvg(0.28, 0.7);
    const level = clamp01(bass * 0.5 + mid * 0.35 + treble * 0.25);

    // asymmetric smoothing: rise a bit quicker than it falls, no snapping
    const attack = 1 - Math.exp(-dt * 18);
    const release = 1 - Math.exp(-dt * 6);
    const damp = (prev: number, next: number) =>
      lerp(prev, next, next > prev ? attack : release);

    out.bass = damp(out.bass, bass);
    out.mid = damp(out.mid, mid);
    out.treble = damp(out.treble, treble);
    out.level = damp(out.level, level);
    out.energy = lerp(out.energy, level, glacial);

    // log-ish spectrum resample into 64 smoothed bins
    const n = out.spectrum.length;
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(Math.pow(i / n, 1.6) * bins);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * bins));
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += this.freq[k]!;
      const v = sum / (hi - lo) / 255;
      out.spectrum[i] = lerp(out.spectrum[i]!, v, v > out.spectrum[i]! ? attack : release);
    }

    // ---- adaptive beat detection on bass energy ---------------------------
    this.history.push(bass);
    if (this.history.length > 60) this.history.shift();
    const mean = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    let variance = 0;
    for (const v of this.history) variance += (v - mean) * (v - mean);
    variance /= this.history.length;
    const threshold = mean + Math.max(0.045, Math.sqrt(variance) * 1.35);

    this.beatCooldown -= dt;
    out.beat = lerp(out.beat, 0, 1 - Math.exp(-dt * 4.5));
    if (bass > threshold && this.beatCooldown <= 0 && bass > 0.12) {
      this.beatCooldown = 0.16;
      const strength = clamp01((bass - mean) * 3.2);
      out.beat = Math.max(out.beat, 0.45 + strength * 0.55);
    }
  }
}
