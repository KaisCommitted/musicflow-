import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ApiError,
  generateLyrics,
  generateLyricsStatus,
  stopLyricsJob,
  type LyricsGenJobStatus,
} from "@/lib/api";

const JOB_LOST_MESSAGE = "This job no longer exists on the server (likely a backend restart) — start a new one.";

interface LyricsGenState {
  jobId: string | null;
  status: LyricsGenJobStatus | null;
  error: string | null;
  starting: boolean;
  stopping: boolean;
  polling: boolean;

  start: (folder: string) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  _poll: () => void;
  _stopPolling: () => void;
  _resumeIfNeeded: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useLyricsGen = create<LyricsGenState>()(
  persist(
    (set, get) => ({
      jobId: null,
      status: null,
      error: null,
      starting: false,
      stopping: false,
      polling: false,

      start: async (folder) => {
        get()._stopPolling();
        set({ error: null, status: null, starting: true });
        try {
          const { job_id } = await generateLyrics(folder);
          set({ jobId: job_id, starting: false });
          get()._poll();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e), starting: false });
        }
      },

      stop: async () => {
        const { jobId } = get();
        if (!jobId) return;
        set({ stopping: true });
        try {
          await stopLyricsJob(jobId);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            get()._stopPolling();
            set({ jobId: null, status: null, error: JOB_LOST_MESSAGE });
            return;
          }
          set({ error: e instanceof Error ? e.message : String(e) });
        } finally {
          set({ stopping: false });
        }
      },

      reset: () => {
        get()._stopPolling();
        set({ jobId: null, status: null, error: null });
      },

      _poll: () => {
        if (pollTimer) clearInterval(pollTimer);
        set({ polling: true });
        const tick = async () => {
          const { jobId } = get();
          if (!jobId) return;
          try {
            const s = await generateLyricsStatus(jobId);
            set({ status: s, error: null });
            if (s.finished) get()._stopPolling();
          } catch (e) {
            get()._stopPolling();
            if (e instanceof ApiError && e.status === 404) {
              set({ jobId: null, status: null, error: JOB_LOST_MESSAGE });
              return;
            }
            set({ error: e instanceof Error ? e.message : String(e) });
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
    }),
    {
      name: "musicflow-lyrics-gen",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        jobId: state.jobId,
        status: state.status,
        error: state.error,
      }),
    },
  ),
);
