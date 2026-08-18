/** Lazily wires the app's one shared <audio> element through a Web Audio AnalyserNode, for the
 * full-screen player's audio-reactive artwork. Module-scoped and created at most once — a
 * MediaElementSourceNode can only ever be created once per <audio> element for its whole
 * lifetime (a second call throws InvalidStateError), and since the audio element itself is also
 * a module-level singleton (see store/player.ts), caching here means every caller just gets the
 * same node. fftSize is high enough to isolate a real bass band out of the spectrum (a coarser
 * FFT lumps kick drums in with everything else); smoothingTimeConstant is on the low side so
 * beat transients aren't smeared out before ReactiveArtwork's own envelope ever sees them. */
let analyser: AnalyserNode | null = null;

export function getAnalyser(audio: HTMLAudioElement): AnalyserNode | null {
  if (analyser) return analyser;
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.55;
    // Creating a MediaElementSourceNode reroutes the element's audio through the Web Audio
    // graph — without reconnecting to the destination, playback would go silent.
    source.connect(node);
    node.connect(ctx.destination);
    if (ctx.state === "suspended") void ctx.resume();
    analyser = node;
    return node;
  } catch {
    // Unsupported browser, or the element's source is cross-origin without CORS headers
    // (tainting getByteFrequencyData) — either way, the visualizer just quietly doesn't render.
    return null;
  }
}
