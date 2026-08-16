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

export type DownloadStatus =
  | "pending"
  | "searching"
  | "downloading"
  | "done"
  | "skipped"
  | "error";

export interface DownloadItem {
  index: number;
  query: string;
  title?: string;
  artist?: string;
  status: DownloadStatus;
  progress?: number;
  error?: string;
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

export const getJobStatus = (jobId: string) => req<JobStatus>(`/api/status/${jobId}`);

export const stopJob = (jobId: string) => req<unknown>(`/api/stop/${jobId}`, { method: "POST" });
export const pauseJob = (jobId: string) => req<unknown>(`/api/pause/${jobId}`, { method: "POST" });
export const resumeJob = (jobId: string) => req<unknown>(`/api/resume/${jobId}`, { method: "POST" });
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

/** TODO(backend): POST /api/playlist/create { folder, name } → writes an empty .m3u8. */
export const createPlaylist = (folder: string, name: string) =>
  req<{ playlist: Playlist }>("/api/playlist/create", {
    method: "POST",
    body: JSON.stringify({ folder, name }),
  });

/** TODO(backend): POST /api/playlist/update { folder, name, songs[] } → rewrites the .m3u8. */
export const updatePlaylist = (folder: string, name: string, songs: string[]) =>
  req<{ playlist: Playlist }>("/api/playlist/update", {
    method: "POST",
    body: JSON.stringify({ folder, name, songs }),
  });

/** TODO(backend): POST /api/playlist/delete { folder, name }. */
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
