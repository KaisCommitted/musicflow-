/**
 * Parsing/matching for the "paste text" playlist creator.
 *
 * Reuses the `--playlistadd Name` / `--playlistend` marker syntax from the old
 * download-textarea playlist maker: a paste can define several playlists at once by
 * wrapping each block, or (with no markers at all) just list songs for one playlist.
 */
import type { Song } from "@/lib/api";

export interface ParsedPlaylistBlock {
  name: string;
  lines: string[];
}

export interface MatchedLine {
  line: string;
  song: Song | null;
}

export interface ResolvedPlaylistBlock {
  name: string;
  matches: MatchedLine[];
  songPaths: string[];
}

/** Splits pasted text into named blocks. Lines outside any `--playlistadd`/`--playlistend`
 * pair fall back to a single block named `fallbackName`. */
export function parseTextPlaylists(raw: string, fallbackName: string): ParsedPlaylistBlock[] {
  const blocks: ParsedPlaylistBlock[] = [];
  const loose: string[] = [];
  let current: ParsedPlaylistBlock | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const addMatch = /^--playlistadd\s*(.*)$/i.exec(line);
    if (addMatch) {
      const name = (addMatch[1] ?? "").trim();
      current = name ? { name, lines: [] } : null;
      if (current) blocks.push(current);
      continue;
    }
    if (/^--playlistend$/i.test(line)) {
      current = null;
      continue;
    }

    (current ? current.lines : loose).push(line);
  }

  if (loose.length) blocks.unshift({ name: fallbackName.trim() || "New Playlist", lines: loose });
  return blocks;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Matches one pasted line against the library by title, or "Artist - Title", falling
 * back to "every word in the line appears somewhere in artist+title" — picking the
 * shortest such match as the closest guess. */
function findBestMatch(line: string, songs: Song[]): Song | null {
  const norm = normalize(line);
  if (!norm) return null;

  for (const s of songs) {
    if (normalize(s.title) === norm || normalize(`${s.artist} - ${s.title}`) === norm) return s;
  }

  const words = norm.split(/\s+/).filter(Boolean);
  let best: Song | null = null;
  let bestLen = Infinity;
  for (const s of songs) {
    const haystack = normalize(`${s.artist} ${s.title}`);
    if (words.every((w) => haystack.includes(w)) && haystack.length < bestLen) {
      best = s;
      bestLen = haystack.length;
    }
  }
  return best;
}

/** Resolves parsed blocks against the library, deduplicating repeated matches within
 * a block so the same song isn't added twice. */
export function resolveTextPlaylists(
  blocks: ParsedPlaylistBlock[],
  songs: Song[],
): ResolvedPlaylistBlock[] {
  return blocks.map((b) => {
    const matches = b.lines.map((line) => ({ line, song: findBestMatch(line, songs) }));
    const songPaths = [...new Set(matches.map((m) => m.song?.path).filter((p): p is string => !!p))];
    return { name: b.name, matches, songPaths };
  });
}
