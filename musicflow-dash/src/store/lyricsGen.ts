import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { generateLyrics, generateLyricsStatus, type LyricsGenJobStatus } from "@/lib/api";

interface LyricsGenState {
  jobId: string | null;
  status: LyricsGenJobStatus | null;
  error: string | null;
  starting: boolean;
  polling: boolean;

  start: (folder: string) => Promise<void>;
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
            set({ error: e instanceof Error ? e.message : String(e) });
            get()._stopPolling();
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
