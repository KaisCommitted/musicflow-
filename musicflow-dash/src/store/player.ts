import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { ARTWORK_SIZES, localStreamUrl, withArtworkSize, type Song } from "@/lib/api";
import { applyDynamicColor, colorFromString, dominantColorFromImage } from "@/lib/colors";

export type RepeatMode = "off" | "all" | "one";

export interface PlayContext {
  label: string;
  /** where the context came from, used for the sidebar quick-resume shortcuts */
  kind: "all" | "album" | "artist" | "genre" | "playlist" | "search" | "download";
}

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  context: PlayContext | null;
  recentContexts: PlayContext[];
  queueOpen: boolean;
  fullscreen: boolean;
  /** Whether the lyrics source currently shown in the full-screen player is time-synced —
   * mirrored here (not just local to FullScreenPlayer) so the global keyboard shortcut handler
   * knows whether Up/Down should do anything. */
  lyricsSynced: boolean;
  /** epoch ms the sleep timer will pause playback at, or null if off. */
  sleepTimerEndAt: number | null;
  /** Pause when the current track finishes, instead of on a fixed timer. */
  sleepAtTrackEnd: boolean;
  /** Full-screen lyrics display size — "big" shows the current line larger (still amid the
   * scrolling list), "huge" shows only three lines centered. Persisted across restarts. */
  lyricsMode: "normal" | "big" | "huge";
  /** Playback position snapshotted on app close, used to resume roughly where playback left
   * off on next launch. Not kept in sync on every tick — see the persist config below. */
  resumeAt: number;

  current: () => Song | null;
  playQueue: (songs: Song[], index: number, context: PlayContext) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: (userTriggered?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playNext: (song: Song) => void;
  addToQueue: (songs: Song[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  jumpTo: (index: number) => void;
  setQueueOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
  setLyricsSynced: (synced: boolean) => void;
  /** Cycles the full-screen lyrics size: normal -> big -> huge -> normal. */
  cycleLyricsMode: () => void;
  /** Pauses in `minutes` minutes; pass null to cancel. Overrides sleepAtTrackEnd. */
  setSleepTimer: (minutes: number | null) => void;
  setSleepAtTrackEnd: (v: boolean) => void;
  _tick: (time: number, duration: number) => void;
}

// zustand's persist middleware writes to storage on *every* set() call — including `_tick`,
// which fires on every `timeupdate` (several times a second while a song plays) — even though
// `partialize` below means the actually-persisted slice (`recentContexts`) almost never
// changes. Without this, that's a synchronous localStorage write several times a second for
// as long as anything is playing. This skips the write whenever the serialized value is
// identical to what's already there, which it is for the overwhelming majority of ticks.
let lastPersisted: string | null = null;
const dedupingLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    if (value === lastPersisted) return;
    lastPersisted = value;
    localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    lastPersisted = null;
    localStorage.removeItem(name);
  },
};

let audio: HTMLAudioElement | null = null;
let sleepTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** The shared <audio> element, for the audio visualizer's AnalyserNode tap. Everything else
 * in this file should keep using the private getAudio() below — this is just a read-only
 * escape hatch for code outside the store. */
export function getAudioElement(): HTMLAudioElement | null {
  return getAudio();
}

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", () => {
      usePlayer.getState()._tick(audio!.currentTime, audio!.duration || 0);
    });
    audio.addEventListener("loadedmetadata", () => {
      usePlayer.getState()._tick(audio!.currentTime, audio!.duration || 0);
    });
    audio.addEventListener("ended", () => {
      const s = usePlayer.getState();
      if (s.sleepAtTrackEnd) {
        audio!.pause();
        usePlayer.setState({ sleepAtTrackEnd: false, isPlaying: false });
        return;
      }
      if (s.repeat === "one") {
        audio!.currentTime = 0;
        void audio!.play();
      } else {
        s.next();
      }
    });
  }
  return audio;
}

async function applyArtColor(song: Song) {
  if (song.artwork) {
    // Sampling only ever looks at a 24x24 canvas — fetching/decoding the original
    // 600x600+ embedded art just for that (on every single track change) was pure waste.
    applyDynamicColor(
      await dominantColorFromImage(withArtworkSize(song.artwork, ARTWORK_SIZES.thumb)),
    );
  } else {
    applyDynamicColor(colorFromString(song.album || song.title));
  }
}

function load(song: Song, autoplay: boolean) {
  const el = getAudio();
  if (!el) return;
  // Paths starting with / are already server-relative URLs (e.g. /api/stream/...)
  el.src =
    song.path.startsWith("http") || song.path.startsWith("/api/")
      ? song.path
      : localStreamUrl(song.path);
  el.volume = usePlayer.getState().muted ? 0 : usePlayer.getState().volume;
  if (autoplay) void el.play().catch(() => undefined);
  void applyArtColor(song);
  usePlayer.setState({ lyricsSynced: false });
}

function rememberContext(list: PlayContext[], ctx: PlayContext) {
  return [ctx, ...list.filter((c) => c.label !== ctx.label)].slice(0, 5);
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      index: -1,
      isPlaying: false,
      shuffle: false,
      repeat: "off",
      volume: 0.8,
      muted: false,
      currentTime: 0,
      duration: 0,
      context: null,
      recentContexts: [],
      queueOpen: false,
      fullscreen: false,
      lyricsSynced: false,
      sleepTimerEndAt: null,
      sleepAtTrackEnd: false,
      lyricsMode: "normal",
      resumeAt: 0,

      current: () => get().queue[get().index] ?? null,

      playQueue: (songs, index, context) => {
        if (!songs.length) return;
        const start = Math.max(0, Math.min(index, songs.length - 1));
        set((s) => ({
          queue: songs,
          index: start,
          context,
          recentContexts: rememberContext(s.recentContexts, context),
          isPlaying: true,
          currentTime: 0,
        }));
        const song = songs[start];
        if (song) load(song, true);
      },

      play: () => {
        const el = getAudio();
        if (el && get().current()) {
          void el.play().catch(() => undefined);
          set({ isPlaying: true });
        }
      },

      pause: () => {
        getAudio()?.pause();
        set({ isPlaying: false });
      },

      toggle: () => (get().isPlaying ? get().pause() : get().play()),

      next: (userTriggered = false) => {
        const { queue, index, shuffle, repeat } = get();
        if (!queue.length) return;
        let nextIndex: number;
        if (shuffle) {
          nextIndex = queue.length === 1 ? 0 : Math.floor(Math.random() * queue.length);
        } else {
          nextIndex = index + 1;
        }
        if (nextIndex >= queue.length) {
          if (repeat === "all" || userTriggered) nextIndex = 0;
          else {
            set({ isPlaying: false });
            getAudio()?.pause();
            return;
          }
        }
        set({ index: nextIndex, currentTime: 0, isPlaying: true });
        const song = queue[nextIndex];
        if (song) load(song, true);
      },

      prev: () => {
        const { queue, index, currentTime } = get();
        const el = getAudio();
        if (currentTime > 4 && el) {
          el.currentTime = 0;
          return;
        }
        const target = index <= 0 ? queue.length - 1 : index - 1;
        const song = queue[target];
        if (!song) return;
        set({ index: target, currentTime: 0, isPlaying: true });
        load(song, true);
      },

      seek: (seconds) => {
        const el = getAudio();
        if (el) el.currentTime = seconds;
        set({ currentTime: seconds });
      },

      setVolume: (v) => {
        const el = getAudio();
        if (el) el.volume = v;
        set({ volume: v, muted: v === 0 });
      },

      toggleMute: () => {
        const { muted, volume } = get();
        const el = getAudio();
        if (el) el.volume = muted ? volume : 0;
        set({ muted: !muted });
      },

      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

      cycleRepeat: () =>
        set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),

      playNext: (song) =>
        set((s) => {
          const queue = [...s.queue];
          queue.splice(s.index + 1, 0, song);
          return { queue };
        }),

      addToQueue: (songs) => set((s) => ({ queue: [...s.queue, ...songs] })),

      removeFromQueue: (i) =>
        set((s) => {
          const queue = s.queue.filter((_, idx) => idx !== i);
          const index = i < s.index ? s.index - 1 : s.index;
          return { queue, index };
        }),

      reorderQueue: (from, to) =>
        set((s) => {
          const queue = [...s.queue];
          const [moved] = queue.splice(from, 1);
          if (!moved) return {};
          queue.splice(to, 0, moved);
          let index = s.index;
          if (from === s.index) index = to;
          else if (from < s.index && to >= s.index) index -= 1;
          else if (from > s.index && to <= s.index) index += 1;
          return { queue, index };
        }),

      jumpTo: (index) => {
        const song = get().queue[index];
        if (!song) return;
        set({ index, currentTime: 0, isPlaying: true });
        load(song, true);
      },

      setQueueOpen: (open) => set({ queueOpen: open }),
      setFullscreen: (open) => set({ fullscreen: open }),

      setLyricsSynced: (synced) => set({ lyricsSynced: synced }),

      cycleLyricsMode: () =>
        set((s) => ({
          lyricsMode: s.lyricsMode === "normal" ? "big" : s.lyricsMode === "big" ? "huge" : "normal",
        })),

      setSleepTimer: (minutes) => {
        if (sleepTimeoutId) {
          clearTimeout(sleepTimeoutId);
          sleepTimeoutId = null;
        }
        if (minutes == null) {
          set({ sleepTimerEndAt: null });
          return;
        }
        sleepTimeoutId = setTimeout(() => {
          getAudio()?.pause();
          set({ isPlaying: false, sleepTimerEndAt: null });
          sleepTimeoutId = null;
        }, minutes * 60_000);
        set({ sleepTimerEndAt: Date.now() + minutes * 60_000, sleepAtTrackEnd: false });
      },

      setSleepAtTrackEnd: (v) => {
        if (sleepTimeoutId) {
          clearTimeout(sleepTimeoutId);
          sleepTimeoutId = null;
        }
        set({ sleepAtTrackEnd: v, sleepTimerEndAt: null });
      },

      _tick: (time, duration) => set({ currentTime: time, duration }),
    }),
    {
      name: "musicflow-player",
      storage: createJSONStorage(() => dedupingLocalStorage),
      // Everything here changes only on explicit user actions (song change, a toggle, app
      // close) — never on the frequent-tick fields (currentTime/duration), which is what
      // keeps the dedupingLocalStorage guard above actually effective. See `resumeAt` for
      // how playback position is captured without persisting on every tick.
      partialize: (state) => ({
        recentContexts: state.recentContexts,
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        lyricsMode: state.lyricsMode,
        queue: state.queue,
        index: state.index,
        context: state.context,
        resumeAt: state.resumeAt,
      }),
      // Restore the last song into the (paused) audio element on launch — always paused,
      // regardless of whether it was playing or paused when the app closed, and seeked to
      // where playback last was.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const song = state.queue[state.index];
        if (!song) return;
        load(song, false);
        const el = getAudio();
        if (el) el.currentTime = state.resumeAt;
        usePlayer.setState({ currentTime: state.resumeAt, isPlaying: false });
      },
    },
  ),
);

if (typeof window !== "undefined") {
  // One explicit snapshot of the playback position on the way out, instead of persisting
  // currentTime reactively (which updates several times a second while a song plays).
  window.addEventListener("beforeunload", () => {
    usePlayer.setState({ resumeAt: usePlayer.getState().currentTime });
  });
}
