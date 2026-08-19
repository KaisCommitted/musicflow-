/** Lazily wires the app's one shared <audio> element through a Web Audio AnalyserNode, for
 * the full-screen visualizer. Module-scoped and created at most once — a MediaElementSourceNode
 * can only ever be created once per <audio> element for its whole lifetime (a second call
 * throws InvalidStateError), and since the audio element itself is also a module-level
 * singleton (see store/player.ts), caching here means every caller just gets the same node.
 *
 * fftSize 2048 (1024 usable bins) — wide enough to resample into a smooth spectrum for the
 * full-screen visualizers, unlike a small-bar strip which only needs a handful of bins. */
let analyser: AnalyserNode | null = null;

export function getAnalyser(audio: HTMLAudioElement): AnalyserNode | null {
  if (analyser) return analyser;
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.72;
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
