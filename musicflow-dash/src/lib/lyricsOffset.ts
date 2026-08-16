/**
 * Per-song synced-lyrics offset (like a subtitle delay), remembered locally by file path.
 * Kept in localStorage rather than backend settings — it's a per-device timing tweak for one
 * song, not something that needs to sync/appear anywhere else.
 */
const KEY = "musicflow:lyrics-offsets";

function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function getLyricsOffset(path: string): number {
  return readAll()[path] ?? 0;
}

export function setLyricsOffset(path: string, offset: number): void {
  const all = readAll();
  const rounded = Math.round(offset * 10) / 10;
  if (rounded === 0) delete all[path];
  else all[path] = rounded;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable/full — offset just won't persist, not worth failing over
  }
}
