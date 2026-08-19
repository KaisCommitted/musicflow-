import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ApiError,
  getJobStatus,
  startDownload,
  pauseJob,
  resumeJob,
  stopJob,
  retryJob,
  jobStreamUrl,
  jobArtworkUrl,
  type DownloadItem,
  type JobStatus,
} from "@/lib/api";
import type { Song } from "@/lib/api";
import { useLibrary } from "@/store/library";

const JOB_LOST_MESSAGE = "This job no longer exists on the server (likely a backend restart) — start a new one.";

/** One Spotify playlist that fed into the current job — the exact query strings it
 * contributed, so completed downloads can be traced back to it once the job finishes. */
export interface SpotifyPlaylistPlan {
  name: string;
  queries: string[];
  /** True when Spotify's embed page (the no-login source for this data) capped out
   * at 100 tracks — the playlist may have more that never got queued. */
  truncated?: boolean;
}

export interface SpotifyImportResult {
  name: string;
  ok: boolean;
  error?: string;
  count: number;
  note?: string;
}

interface DownloadState {
  jobId: string | null;
  status: JobStatus | null;
  items: DownloadItem[];
  error: string | null;
  polling: boolean;
  spotifyPlaylists: SpotifyPlaylistPlan[];
  spotifyPlaylistsApplied: boolean;
  spotifyPlaylistResults: SpotifyImportResult[] | null;

  start: (
    queries: string[],
    opts?: { playlists?: SpotifyPlaylistPlan[]; resolveFailures?: { name: string; error: string }[] },
  ) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retry: () => void;
  clear: () => void;
  _poll: () => void;
  _stopPolling: () => void;
  _resumeIfNeeded: () => void;
  _handleJobError: (e: unknown) => void;
  _applySpotifyPlaylists: () => Promise<void>;

  playableSongs: () => Song[];
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useDownload = create<DownloadState>()(
  persist(
    (set, get) => ({
      jobId: null,
      status: null,
      items: [],
      error: null,
      polling: false,
      spotifyPlaylists: [],
      spotifyPlaylistsApplied: false,
      spotifyPlaylistResults: null,

      start: async (queries, opts) => {
        get()._stopPolling();
        const resolveFailures = opts?.resolveFailures ?? [];
        set({
          error: null,
          status: null,
          items: [],
          spotifyPlaylists: opts?.playlists ?? [],
          spotifyPlaylistsApplied: false,
          spotifyPlaylistResults: resolveFailures.length
            ? resolveFailures.map((f) => ({ ...f, ok: false, count: 0 }))
            : null,
        });
        try {
          const { job_id } = await startDownload(queries);
          set({ jobId: job_id });
          get()._poll();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },

      pause: () => {
        const { jobId } = get();
        if (jobId) void pauseJob(jobId).catch((e) => get()._handleJobError(e));
      },

      resume: () => {
        const { jobId } = get();
        if (jobId) void resumeJob(jobId).catch((e) => get()._handleJobError(e));
      },

      stop: () => {
        const { jobId } = get();
        if (jobId) void stopJob(jobId).catch((e) => get()._handleJobError(e));
      },

      retry: () => {
        const { jobId } = get();
        if (jobId) {
          void retryJob(jobId)
            .then(() => get()._poll())
            .catch((e) => get()._handleJobError(e));
        }
      },

      _handleJobError: (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          get()._stopPolling();
          set({ jobId: null, status: null, items: [], error: JOB_LOST_MESSAGE });
        }
      },

      clear: () => {
        get()._stopPolling();
        set({
          jobId: null,
          status: null,
          items: [],
          error: null,
          spotifyPlaylists: [],
          spotifyPlaylistsApplied: false,
          spotifyPlaylistResults: null,
        });
      },

      _poll: () => {
        if (pollTimer) clearInterval(pollTimer);
        set({ polling: true });
        const tick = async () => {
          const { jobId } = get();
          if (!jobId) return;
          try {
            const s = await getJobStatus(jobId);
            set({ status: s, items: s.recent ?? [], error: null });
            if (s.finished) {
              // At least one song landed on disk (with its tags — process_query only marks an
              // item "done" after metadata/artwork are written) — rescan so it shows up in the
              // Library tab without waiting for the next app launch or a manual refresh.
              if (s.done > 0) void useLibrary.getState().refresh();
              // Keep polling a few more times to catch final metadata completions
              let extra = 3;
              const finalPoll = setInterval(async () => {
                try {
                  const f = await getJobStatus(jobId);
                  set({ status: f, items: f.recent ?? [] });
                } catch { /* ignore */ }
                extra--;
                if (extra <= 0) {
                  clearInterval(finalPoll);
                  void get()._applySpotifyPlaylists();
                }
              }, 2000);
              get()._stopPolling();
            }
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) {
              get()._handleJobError(e);
              return;
            }
            // Don't stop polling on other transient errors (network blips, etc.)
          }
        };
        void tick();
        pollTimer = setInterval(tick, 1000);
      },

      _stopPolling: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        set({ polling: false });
      },

      _resumeIfNeeded: () => {
        const { jobId, status } = get();
        if (jobId && (!status || !status.finished) && !pollTimer) {
          get()._poll();
        }
      },

      // Runs once per job, after the job (plus its final metadata-catchup polls) is done.
      // Traces each Spotify playlist's own queries back to the items that downloaded from
      // them, and creates a matching Musicflow playlist out of whichever ones landed.
      _applySpotifyPlaylists: async () => {
        const { spotifyPlaylists, spotifyPlaylistsApplied, items } = get();
        if (!spotifyPlaylists.length || spotifyPlaylistsApplied) return;
        set({ spotifyPlaylistsApplied: true });

        const pathByQuery = new Map<string, string>();
        for (const i of items) {
          if ((i.status === "done" || i.status === "skipped") && i.path) pathByQuery.set(i.query, i.path);
        }

        const created: SpotifyImportResult[] = [];
        for (const plan of spotifyPlaylists) {
          const paths = [...new Set(plan.queries.map((q) => pathByQuery.get(q)).filter((p): p is string => !!p))];
          if (!paths.length) {
            created.push({ name: plan.name, ok: false, error: "No songs downloaded", count: 0 });
            continue;
          }
          // Same name as an existing playlist: number it rather than overwrite.
          let name = plan.name;
          let n = 2;
          while (useLibrary.getState().playlists.some((p) => p.name === name)) name = `${plan.name} (${n++})`;
          const r = await useLibrary.getState().createPlaylistWithSongs(name, paths);
          const note = plan.truncated ? "Only the first 100 tracks could be read from Spotify" : undefined;
          created.push(
            r.ok
              ? { name, ok: true, count: paths.length, ...(note ? { note } : {}) }
              : { name, ok: false, error: r.error ?? "Couldn't create the playlist", count: paths.length },
          );
        }

        set((s) => ({ spotifyPlaylistResults: [...(s.spotifyPlaylistResults ?? []), ...created] }));
      },

      playableSongs: () => {
        const { jobId, items } = get();
        if (!jobId) return [];
        return items
          .filter((i) => i.status === "done" || i.status === "skipped")
          .map((i) => ({
            id: `dl-${jobId}-${i.index}`,
            path: jobStreamUrl(jobId, i.index),
            title: i.title ?? i.query,
            artist: i.artist ?? "",
            album: "Downloads",
            duration: 0,
            artwork: jobArtworkUrl(jobId, i.index),
            genre: "",
          }));
      },
    }),
    {
      name: "musicflow-download",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        jobId: state.jobId,
        status: state.status,
        items: state.items,
        error: state.error,
        spotifyPlaylists: state.spotifyPlaylists,
        spotifyPlaylistsApplied: state.spotifyPlaylistsApplied,
        spotifyPlaylistResults: state.spotifyPlaylistResults,
      }),
      onRehydrate: () => (state) => {
        // Resume polling if the job was still running when the page refreshed
        state?._resumeIfNeeded();
      },
    },
  ),
);
