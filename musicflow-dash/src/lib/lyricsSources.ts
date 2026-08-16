/** Human-readable labels for the backend's lyrics source slugs (main.py's LYRICS_SOURCE_ORDER). */
const LYRICS_SOURCE_LABELS: Record<string, string> = {
  lrclib: "LRCLIB",
  netease: "NetEase",
  "lrclib-exact": "LRCLIB (exact)",
  "lrclib-search": "LRCLIB (search)",
  "lyrics-ovh": "Lyrics.ovh",
  genius: "Genius",
};

export const lyricsSourceLabel = (method: string) => LYRICS_SOURCE_LABELS[method] ?? method;
