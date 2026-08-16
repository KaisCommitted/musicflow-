/**
 * Parsing/matching for the "paste text" playlist creator.
 *
 * Reuses the `--playlistadd Name` / `--playlistend` marker syntax from the old
 * download-textarea playlist maker: a paste can define several playlists at once by
 * wrapping each block. Lines outside a block are ignored.
 */
import type { Playlist, Song } from "@/lib/api";

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

/** Splits pasted text into named blocks. Only lines inside a `--playlistadd Name` /
 * `--playlistend` pair are kept — anything outside a block is ignored. */
export function parseTextPlaylists(raw: string): ParsedPlaylistBlock[] {
  const blocks: ParsedPlaylistBlock[] = [];
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

    current?.lines.push(line);
  }

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

/** Builds a ready-to-paste prompt for an LLM: the whole library, the playlists that
 * already exist (so it doesn't recreate or ignore them), and an explanation of the
 * --playlistadd/--playlistend syntax — so the reply can be pasted straight back into
 * the "Paste text" tab. */
export function buildPlaylistPrompt(songs: Song[], playlists: Playlist[]): string {
  const sortedSongs = [...songs].sort((a, b) =>
    `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`),
  );
  const label = (s: Song) => `${s.artist} - ${s.title}`;
  const labelByPath = new Map(sortedSongs.map((s) => [s.path, label(s)]));

  const sections: string[] = [
    `Here are all the songs in my music library:\n\n${sortedSongs.map(label).join("\n")}`,
  ];

  if (playlists.length) {
    const existing = playlists
      .map((p) => {
        const titles = p.songs.map((path) => labelByPath.get(path)).filter((t): t is string => !!t);
        return `--playlistadd ${p.name}\n${titles.join("\n")}\n--playlistend`;
      })
      .join("\n\n");
    sections.push(
      `Here are the playlists I already have, for context — don't recreate these:\n\n${existing}`,
    );
  }

  sections.push(`I use a custom media player where playlists are created from plain text using this syntax:

--playlistadd Playlist Name
Song Title 1
Song Title 2
--playlistend

Rules:
- Wrap each playlist's songs between "--playlistadd <name>" and "--playlistend".
- You can define multiple playlists at once — just repeat the block for each one.
- The same song can appear in more than one playlist if it genuinely fits more than one.
- Use the exact song entries from the library list above, one per line, inside each block.
- Playlist names must be unique, including against my existing playlists listed above — if you want to expand on one of those, give it a new name (e.g. "Road Trip 2") rather than reusing the original.`);

  sections.push(
    `Please divide my songs into a handful of well-thought-out playlists based on genre, vibe, mood, and when I'd realistically listen to them (e.g. workout, focus, late night, driving, rainy days, parties). Give each playlist a short, descriptive name, and reply with ONLY the playlists using the syntax above — no extra commentary before or after.`,
  );

  return sections.join("\n\n");
}
