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

interface DownloadState {
  jobId: string | null;
  status: JobStatus | null;
  items: DownloadItem[];
  error: string | null;
  polling: boolean;

  start: (queries: string[]) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retry: () => void;
  clear: () => void;
  _poll: () => void;
  _stopPolling: () => void;
  _resumeIfNeeded: () => void;
  _handleJobError: (e: unknown) => void;

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

      start: async (queries) => {
        get()._stopPolling();
        set({ error: null, status: null, items: [] });
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
        set({ jobId: null, status: null, items: [], error: null });
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
                if (extra <= 0) clearInterval(finalPoll);
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
      }),
      onRehydrate: () => (state) => {
        // Resume polling if the job was still running when the page refreshed
        state?._resumeIfNeeded();
      },
    },
  ),
);
