import { create } from "zustand";
import type { Song } from "@/lib/api";
import { localStreamUrl } from "@/lib/api";
import { applyDynamicColor, colorFromString, dominantColorFromImage } from "@/lib/colors";

export type RepeatMode = "off" | "all" | "one";

export interface PlayContext {
  label: string;
  /** where the context came from, used for the sidebar quick-resume shortcuts */
  kind: "all" | "album" | "artist" | "playlist" | "search" | "download";
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
  lyricsOpen: boolean;
  fullscreen: boolean;

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
  setLyricsOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
  _tick: (time: number, duration: number) => void;
}

let audio: HTMLAudioElement | null = null;

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
    applyDynamicColor(await dominantColorFromImage(song.artwork));
  } else {
    applyDynamicColor(colorFromString(song.album || song.title));
  }
}

function load(song: Song, autoplay: boolean) {
  const el = getAudio();
  if (!el) return;
  // Paths starting with / are already server-relative URLs (e.g. /api/stream/...)
  el.src = song.path.startsWith("http") || song.path.startsWith("/api/")
    ? song.path
    : localStreamUrl(song.path);
  el.volume = usePlayer.getState().muted ? 0 : usePlayer.getState().volume;
  if (autoplay) void el.play().catch(() => undefined);
  void applyArtColor(song);
}

function rememberContext(list: PlayContext[], ctx: PlayContext) {
  return [ctx, ...list.filter((c) => c.label !== ctx.label)].slice(0, 3);
}

export const usePlayer = create<PlayerState>((set, get) => ({
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
  lyricsOpen: false,
  fullscreen: false,

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
  setLyricsOpen: (open) => set({ lyricsOpen: open }),
  setFullscreen: (open) => set({ fullscreen: open }),

  _tick: (time, duration) => set({ currentTime: time, duration }),
}));
