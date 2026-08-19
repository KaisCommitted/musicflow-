/**
 * Centralized API service for the Musicflow Flask backend.
 * All network access in the app goes through this file.
 */

const BASE = "";

/** Thrown by req() on a non-2xx response. Carries the HTTP status so callers can
 * tell "this job no longer exists" (404 — e.g. the backend restarted and lost its
 * in-memory job state) apart from other failures. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, statusText: string, path: string) {
    super(`${status} ${statusText} — ${path}`);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText, path);
  return (await res.json()) as T;
}

/* ---------------------------------- types --------------------------------- */

export type DownloadStatus = "pending" | "searching" | "downloading" | "done" | "skipped" | "error";

export interface DownloadItem {
  index: number;
  query: string;
  title?: string;
  artist?: string;
  status: DownloadStatus;
  progress?: number;
  error?: string;
  /** Real library-relative file path — set once status is "done" or "skipped". */
  path?: string | null;
}

export interface JobStatus {
  total: number;
  done: number;
  skipped: number;
  errors: number;
  cancelled: boolean;
  active: number;
  pending: number;
  finished: boolean;
  paused: boolean;
  recent: DownloadItem[];
  /** True when the most recent retry cycle failed 100% with HTTP 403 — a strong sign YouTube
   * is blocking anonymous requests outright, and reconnecting a YouTube login (see the
   * youtube-cookies endpoints) is the most likely fix. */
  likelyBlocked: boolean;
}

export interface HistoryJobSummary {
  id: string;
  date: string;
  total: number;
  done: number;
  skipped?: number;
  errors: number;
}

export interface HistoryDetail {
  id: string;
  date: string;
  page: number;
  per_page: number;
  pages: number;
  total: number;
  items: DownloadItem[];
}

export interface Song {
  /** Stable id — absolute file path is used when available. */
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  /** seconds */
  duration: number;
  track?: number;
  year?: number;
  artwork?: string | null;
  /** ID3 genre tag — "" when untagged. */
  genre: string;
}

export interface Playlist {
  /** m3u8 file name without extension */
  name: string;
  path?: string;
  /** song file paths */
  songs: string[];
  color?: string;
}

export interface LyricsResponse {
  lyrics: string | null;
}

/* -------------------------------- downloads ------------------------------- */

export const startDownload = (queries: string[]) =>
  req<{ job_id: string }>("/api/start", {
    method: "POST",
    body: JSON.stringify({ queries }),
  });

export interface SpotifyResolvedPlaylist {
  url: string;
  /** Present when this link resolved successfully. */
  name?: string;
  /** "Artist - Title" queries, one per track — feed straight into startDownload(). */
  queries?: string[];
  /** Present when this link failed to resolve. */
  error?: string;
  /** True when the playlist likely has more tracks than were returned — Spotify's
   * public embed page (used to read playlists with no login) caps out at 100. */
  truncated?: boolean;
}

/** Reads one or more Spotify playlist links and returns each as a track-query list.
 * Doesn't start a download itself — pass the combined queries to startDownload(). */
export const resolveSpotifyPlaylists = (urls: string[]) =>
  req<{ playlists: SpotifyResolvedPlaylist[] }>("/api/spotify/resolve", {
    method: "POST",
    body: JSON.stringify({ urls }),
  });

export interface YoutubeResolvedPlaylist {
  url: string;
  /** Present when this link resolved successfully. */
  name?: string;
  /** "Artist - Title" queries, one per video — feed straight into startDownload(). */
  queries?: string[];
  /** Present when this link failed to resolve. */
  error?: string;
  /** True when the playlist has more videos than were returned (capped server-side). */
  truncated?: boolean;
}

/** Reads one or more YouTube playlist links and returns each as a track-query list, same
 * shape (and same downstream use) as resolveSpotifyPlaylists. */
export const resolveYoutubePlaylists = (urls: string[]) =>
  req<{ playlists: YoutubeResolvedPlaylist[] }>("/api/youtube/resolve", {
    method: "POST",
    body: JSON.stringify({ urls }),
  });

export const getJobStatus = (jobId: string) => req<JobStatus>(`/api/status/${jobId}`);

export const stopJob = (jobId: string) => req<unknown>(`/api/stop/${jobId}`, { method: "POST" });
export const pauseJob = (jobId: string) => req<unknown>(`/api/pause/${jobId}`, { method: "POST" });
export const resumeJob = (jobId: string) =>
  req<unknown>(`/api/resume/${jobId}`, { method: "POST" });
export const retryJob = (jobId: string) => req<unknown>(`/api/retry/${jobId}`, { method: "POST" });

export const jobStreamUrl = (jobId: string, index: number) => `/api/stream/${jobId}/${index}`;
export const jobArtworkUrl = (jobId: string, index: number) => `/api/artwork/${jobId}/${index}`;
export const getJobLyrics = (jobId: string, index: number) =>
  req<LyricsResponse>(`/api/lyrics/${jobId}/${index}`);

/* --------------------------------- history -------------------------------- */

export const getHistory = () => req<{ jobs: HistoryJobSummary[] }>("/api/history");

export const getHistoryDetail = (
  id: string,
  opts: { page?: number; per_page?: number; status?: string } = {},
) => {
  const qs = new URLSearchParams();
  if (opts.page) qs.set("page", String(opts.page));
  if (opts.per_page) qs.set("per_page", String(opts.per_page));
  if (opts.status && opts.status !== "all") qs.set("status", opts.status);
  const q = qs.toString();
  return req<HistoryDetail>(`/api/history/${id}${q ? `?${q}` : ""}`);
};

export const retryHistoryItem = (history_id: string, query: string) =>
  req<{ job_id?: string }>("/api/history/retry", {
    method: "POST",
    body: JSON.stringify({ history_id, query }),
  });

/* ---------------------------- playlists & scanning ------------------------- */

export const scanFolder = (folder: string) =>
  req<{ songs: Song[]; issues: LibraryIssuesReport }>("/api/scan", {
    method: "POST",
    body: JSON.stringify({ folder }),
  });

export const getPlaylists = (folder: string, lines: string[] = []) =>
  req<{ playlists: Playlist[] }>("/api/playlists", {
    method: "POST",
    body: JSON.stringify({ folder, lines }),
  });

export const browseFolder = () => req<{ folder: string }>("/api/browse", { method: "POST" });

/* ---------------------------- lyrics generation ---------------------------- */

export type LyricsGenStatus = "pending" | "processing" | "done" | "not_found" | "cancelled";

export interface LyricsGenItem {
  file: string;
  status: LyricsGenStatus;
  error?: string | null;
  found_count: number;
}

export interface LyricsGenJobStatus {
  total: number;
  processed: number;
  done: number;
  not_found: number;
  finished: boolean;
  cancelled: boolean;
  items: LyricsGenItem[];
}

export const generateLyrics = (folder: string) =>
  req<{ job_id: string; total: number }>("/api/generate-lyrics", {
    method: "POST",
    body: JSON.stringify({ folder }),
  });

export const generateLyricsStatus = (jobId: string) =>
  req<LyricsGenJobStatus>(`/api/generate-lyrics/status/${jobId}`);

export const stopLyricsJob = (jobId: string) =>
  req<{ ok: boolean }>(`/api/generate-lyrics/stop/${jobId}`, { method: "POST" });

/* --------------------------------- settings -------------------------------- */

export const getSettings = () => req<Record<string, string>>("/api/settings");

export const saveSettings = (settings: Record<string, string>) =>
  req<Record<string, string>>("/api/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });

/* ------------------------------------------------------------------ *
 * Library / file endpoints
 * ------------------------------------------------------------------ */

export const getLibrary = (folder: string) =>
  req<{ songs: Song[] }>(`/api/library?folder=${encodeURIComponent(folder)}`);

/** TODO(backend): GET /api/file?path=... → streams a local mp3 with range support. */
export const localStreamUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;

/** TODO(backend): GET /api/cover?path=... → embedded ID3 artwork (or 404). */
export const localArtworkUrl = (path: string) => `/api/cover?path=${encodeURIComponent(path)}`;

/** Appends a `size` hint to a `/api/cover` or `/api/artwork` URL so the backend returns a
 * downscaled JPEG instead of the original (often 600x600+) embedded artwork — the difference
 * between a few KB and ~100KB per image, multiplied by every thumbnail on screen. Pick from
 * ARTWORK_SIZES rather than an arbitrary number so repeated uses of "the same" size (e.g. every
 * row thumbnail) hit the backend's resize cache instead of each minting their own variant. */
export const ARTWORK_SIZES = { thumb: 96, large: 320 } as const;
export function withArtworkSize(url: string, size: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}size=${size}`;
}

/** TODO(backend): GET /api/local-lyrics?path=... → { lyrics } from the USLT frame. */
export const getLocalLyrics = (path: string) =>
  req<LyricsResponse>(`/api/local-lyrics?path=${encodeURIComponent(path)}`);

/** Every lyrics source that has ever been found for this song (each saved as its own
 * {basename}.{method}.lrc backup) — used to switch between them like picking a subtitle track. */
export interface LyricsSource {
  method: string;
  synced: boolean;
  /** true if this is the source currently embedded as the song's main lyrics */
  active: boolean;
  text: string;
}

export const getLyricsSources = (path: string) =>
  req<{ sources: LyricsSource[] }>(`/api/lyrics/sources?path=${encodeURIComponent(path)}`);

/** Persists the pick: overwrites the ID3 USLT tag + main .lrc, same as the batch job's
 * priority-order auto-swap. */
export const setLyricsSource = (path: string, method: string) =>
  req<{ ok: boolean; lyrics: string; synced: boolean }>("/api/lyrics/set-source", {
    method: "POST",
    body: JSON.stringify({ path, method }),
  });

/** Permanently corrects one source's saved timing by delta seconds — rewrites its
 * {basename}.{method}.lrc backup directly (and the main ID3/lrc too, if that source is main).
 * No client-side display offset involved. */
export const shiftLyricsOffset = (path: string, method: string, delta: number) =>
  req<{ ok: boolean; lyrics: string }>("/api/lyrics/shift-offset", {
    method: "POST",
    body: JSON.stringify({ path, method, delta }),
  });

/** POST /api/playlist/create { folder, name } → writes an empty .m3u8 (no-op if it already exists). */
export const createPlaylist = (folder: string, name: string) =>
  req<{ playlist: Playlist }>("/api/playlist/create", {
    method: "POST",
    body: JSON.stringify({ folder, name }),
  });

/** POST /api/playlist/update { folder, name, songs[] } → rewrites the .m3u8 with this exact song list. */
export const updatePlaylist = (folder: string, name: string, songs: string[]) =>
  req<{ playlist: Playlist }>("/api/playlist/update", {
    method: "POST",
    body: JSON.stringify({ folder, name, songs }),
  });

/** POST /api/playlist/delete { folder, name }. */
export const deletePlaylist = (folder: string, name: string) =>
  req<{ ok: boolean }>("/api/playlist/delete", {
    method: "POST",
    body: JSON.stringify({ folder, name }),
  });

/* ---------------------------- library cleanup ---------------------------- */

export interface LibraryIssueFile {
  path: string;
  size: number;
  corrupt: boolean;
  corrupt_reason: string | null;
  has_artwork: boolean;
  has_lyrics: boolean;
  /** true for the copy the backend recommends keeping */
  keep: boolean;
  /** sidecar .lrc files tied to this mp3 that would be deleted alongside it */
  related: string[];
}

export interface DuplicateGroup {
  artist: string;
  title: string;
  keep: string | null;
  /** every copy in this group is corrupt — no keeper, the song would be lost entirely */
  all_corrupt: boolean;
  files: LibraryIssueFile[];
}

export interface StandaloneCorruptFile {
  path: string;
  size: number;
  reason: string | null;
  related: string[];
}

export interface LibraryIssuesReport {
  duplicate_groups: DuplicateGroup[];
  standalone_corrupt: StandaloneCorruptFile[];
}

export const resolveLibraryIssues = (folder: string, deletePaths: string[]) =>
  req<{ deleted: string[]; songs: Song[]; issues: LibraryIssuesReport }>(
    "/api/library/resolve-issues",
    { method: "POST", body: JSON.stringify({ folder, delete: deletePaths }) },
  );

/** POST /api/song/delete { folder, path } → deletes the mp3 (and its embedded metadata
 * with it), its .lrc sidecar + any lyrics-source backups, and strips it from every
 * playlist that referenced it. */
export const deleteSong = (folder: string, path: string) =>
  req<{ ok: boolean; deleted: string[]; updated_playlists: string[]; songs: Song[] }>(
    "/api/song/delete",
    { method: "POST", body: JSON.stringify({ folder, path }) },
  );

/* ---------------------------------- backup --------------------------------- */

/** GET — a plain link/download href, not a fetch() call (it returns a file attachment). */
export const backupExportUrl = () => "/api/backup/export";

export interface BackupData {
  version?: number;
  exported_at?: string;
  settings?: Record<string, string>;
  playlists?: { name: string; songs: string[] }[];
}

/** Settings' `musicFolder` is deliberately ignored server-side — this machine's own folder
 * stays as configured rather than getting repointed at a path from wherever the backup was
 * taken. */
export const importBackup = (data: BackupData) =>
  req<{ ok: boolean; imported_settings: number; imported_playlists: number; warning?: string }>(
    "/api/backup/import",
    { method: "POST", body: JSON.stringify(data) },
  );

/* --------------------------- Discord Rich Presence -------------------------- */
/* No-ops server-side unless Settings has both the toggle on and a client ID — the frontend
 * doesn't need to know either, it just reports what's playing on song-change/play-pause. */

export const updateDiscordPresence = (payload: {
  title: string;
  artist: string;
  is_playing: boolean;
  position: number;
  duration: number;
}) =>
  req<{ ok: boolean; active: boolean }>("/api/discord/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const clearDiscordPresence = () =>
  req<{ ok: boolean }>("/api/discord/clear", { method: "POST" });

/* ------------------------------ ListenBrainz scrobbling ---------------------------- */
/* The user's token stays server-side (in the settings DB) — the frontend just reports what's
 * playing, same shape as the Discord presence calls above. */

interface ScrobblePayload {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export const reportNowPlaying = (payload: ScrobblePayload) =>
  req<{ ok: boolean; active: boolean }>("/api/scrobble/now-playing", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const submitScrobble = (payload: ScrobblePayload) =>
  req<{ ok: boolean; active: boolean }>("/api/scrobble/listen", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** Checks a token against ListenBrainz and, if valid, saves it + the resolved username
 * server-side (same "paste and it just works" flow, now with a "Connected as X" result). */
export const validateListenbrainzToken = (token: string) =>
  req<{ ok: boolean; username: string }>("/api/listenbrainz/validate", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

export const disconnectListenbrainz = () =>
  req<{ ok: boolean }>("/api/listenbrainz/disconnect", { method: "POST" });

/* --------------------------------- Last.fm scrobbling -------------------------------- */
/* Unlike ListenBrainz's plain token, Last.fm needs a one-time browser authorization per
 * account — auth-start hands back a URL to open + a token; once the user approves it there,
 * auth-complete exchanges that token for a permanent session key (stored server-side). */

export const startLastfmAuth = () =>
  req<{ token: string; url: string }>("/api/lastfm/auth-start", { method: "POST" });

export const completeLastfmAuth = (token: string) =>
  req<{ ok: boolean; username: string }>("/api/lastfm/auth-complete", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

export const disconnectLastfm = () =>
  req<{ ok: boolean }>("/api/lastfm/disconnect", { method: "POST" });

export const reportLastfmNowPlaying = (payload: ScrobblePayload) =>
  req<{ ok: boolean; active: boolean }>("/api/lastfm/now-playing", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const submitLastfmScrobble = (payload: ScrobblePayload) =>
  req<{ ok: boolean; active: boolean }>("/api/lastfm/scrobble", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/* ------------------------------- YouTube login (cookies) ------------------------------ */
/* A one-time export from a real browser to a static file — see server.py for why this is a
 * file, not a live browser read on every download. */

/** Checks every installed browser for a real YouTube login and returns the ones that have
 * one — takes a moment (each browser is a real, if quick, check), not instant. `locked` and
 * `blocked` are different from "not found": those browsers exist and we couldn't even check
 * them (open right now / Chromium's App-Bound Encryption) — worth telling apart from "sign in
 * somewhere", since for all we know they already have. */
export const scanYoutubeCookieBrowsers = () =>
  req<{ browsers: string[]; locked: string[]; blocked: string[] }>(
    "/api/youtube-cookies/scan",
    { method: "POST" },
  );

export const getYoutubeCookieStatus = () =>
  req<{ configured: boolean; browser: string }>("/api/youtube-cookies/status");

/** Opens `browser` at youtube.com so someone with more than one Google account signed in there
 * can see (and switch, via YouTube's own account menu) which one is currently active — that's
 * the account Connect will actually export, and there's no way to pick a different one from
 * inside Musicflow itself. */
export const openYoutubeInBrowser = (browser: string) =>
  req<{ ok: boolean }>("/api/youtube-cookies/open", {
    method: "POST",
    body: JSON.stringify({ browser }),
  });

/** Not routed through req() — the backend's error message here (e.g. "no YouTube login found
 * in firefox") is specific and actionable, worth showing as-is instead of a generic failure.
 * `closeFirst` closes every process for `browser` before reading its cookies — only meaningful
 * for a browser the scan reported as "locked" (currently open, which is what blocked us from
 * reading it in the first place). Callers should only ever set this from an explicit,
 * separately-labeled "close & connect" action, never as a default — closing someone's browser
 * shouldn't be a side effect of a plain "Connect" click. */
export const setupYoutubeCookies = async (
  browser: string,
  closeFirst = false,
): Promise<{ ok: true }> => {
  const res = await fetch(`${BASE}/api/youtube-cookies/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browser, closeFirst }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
};

export const disconnectYoutubeCookies = () =>
  req<{ ok: boolean }>("/api/youtube-cookies/disconnect", { method: "POST" });
