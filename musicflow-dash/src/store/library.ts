import { create } from "zustand";
import { getPlaylists, getSettings, saveSettings, scanFolder, type Playlist, type Song } from "@/lib/api";

export interface Settings {
  musicFolder: string;
  theme: "dark" | "light";
  crossfade: number;
  showPlaylistTags: boolean;
  autoScanOnStart: boolean;
  gaplessPlayback: boolean;
  fetchLyricsAutomatically: boolean;
}

interface LibraryState {
  songs: Song[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  settings: Settings;
  search: string;
  settingsLoaded: boolean;

  setSearch: (q: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  loadSettings: () => Promise<void>;
  refresh: () => Promise<void>;
  addPlaylist: (name: string) => void;
  removePlaylist: (name: string) => void;
  addSongToPlaylist: (name: string, songPath: string) => void;
  removeSongFromPlaylist: (name: string, songPath: string) => void;
  playlistsForSong: (songPath: string) => string[];
}

const defaultSettings: Settings = {
  musicFolder: "",
  theme: "dark",
  crossfade: 0,
  showPlaylistTags: true,
  autoScanOnStart: true,
  gaplessPlayback: true,
  fetchLyricsAutomatically: true,
};

function parseSettings(raw: Record<string, string>): Settings {
  return {
    musicFolder: raw["musicFolder"] ?? "",
    theme: (raw["theme"] as "dark" | "light") ?? "dark",
    crossfade: Number(raw["crossfade"] ?? 0),
    showPlaylistTags: raw["showPlaylistTags"] !== "false",
    autoScanOnStart: raw["autoScanOnStart"] !== "false",
    gaplessPlayback: raw["gaplessPlayback"] !== "false",
    fetchLyricsAutomatically: raw["fetchLyricsAutomatically"] !== "false",
  };
}

function serializeSettings(s: Settings): Record<string, string> {
  return {
    musicFolder: s.musicFolder,
    theme: s.theme,
    crossfade: String(s.crossfade),
    showPlaylistTags: String(s.showPlaylistTags),
    autoScanOnStart: String(s.autoScanOnStart),
    gaplessPlayback: String(s.gaplessPlayback),
    fetchLyricsAutomatically: String(s.fetchLyricsAutomatically),
  };
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  songs: [],
  playlists: [],
  loading: false,
  error: null,
  settings: defaultSettings,
  search: "",
  settingsLoaded: false,

  setSearch: (q) => set({ search: q }),

  loadSettings: async () => {
    try {
      const raw = await getSettings();
      const settings = parseSettings(raw);
      set({ settings, settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  updateSettings: (patch) => {
    const merged = { ...get().settings, ...patch };
    set({ settings: merged });
    // Persist to backend (fire-and-forget)
    void saveSettings(serializeSettings(merged));
  },

  refresh: async () => {
    const folder = get().settings.musicFolder;
    set({ loading: true, error: null });
    if (!folder) {
      set({ songs: [], playlists: [], loading: false, error: "No music folder configured" });
      return;
    }
    try {
      const [{ songs }, { playlists }] = await Promise.all([
        scanFolder(folder),
        getPlaylists(folder),
      ]);
      set({ songs, playlists, loading: false, error: null });
    } catch (e) {
      set({
        songs: [],
        playlists: [],
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  addPlaylist: (name) =>
    set((s) =>
      s.playlists.some((p) => p.name === name)
        ? {}
        : { playlists: [...s.playlists, { name, songs: [] }] },
    ),

  removePlaylist: (name) =>
    set((s) => ({ playlists: s.playlists.filter((p) => p.name !== name) })),

  addSongToPlaylist: (name, songPath) =>
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.name === name && !p.songs.includes(songPath)
          ? { ...p, songs: [...p.songs, songPath] }
          : p,
      ),
    })),

  removeSongFromPlaylist: (name, songPath) =>
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.name === name ? { ...p, songs: p.songs.filter((x) => x !== songPath) } : p,
      ),
    })),

  playlistsForSong: (songPath) =>
    get()
      .playlists.filter((p) => p.songs.includes(songPath))
      .map((p) => p.name),
}));
