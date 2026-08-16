import { create } from "zustand";
import {
  getPlaylists,
  getSettings,
  resolveLibraryIssues,
  saveSettings,
  scanFolder,
  type LibraryIssuesReport,
  type Playlist,
  type Song,
} from "@/lib/api";

export interface Settings {
  musicFolder: string;
  theme: "dark" | "light";
  crossfade: number;
  showPlaylistTags: boolean;
  autoScanOnStart: boolean;
  gaplessPlayback: boolean;
  fetchLyricsAutomatically: boolean;
  /** JSON-encoded Record<KeybindActionId, string>; "" means defaults. */
  keybinds: string;
}

interface LibraryState {
  songs: Song[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  settings: Settings;
  search: string;
  settingsLoaded: boolean;
  /** Duplicate/corrupt files found by the most recent scan (initial load or rescan). */
  issues: LibraryIssuesReport | null;

  setSearch: (q: string) => void;
  setSongs: (songs: Song[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  loadSettings: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteIssueFiles: (paths: string[]) => Promise<void>;
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
  keybinds: "",
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
    keybinds: raw["keybinds"] ?? "",
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
    keybinds: s.keybinds,
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
  issues: null,

  setSearch: (q) => set({ search: q }),
  setSongs: (songs) => set({ songs }),

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
      set({ songs: [], playlists: [], issues: null, loading: false, error: "No music folder configured" });
      return;
    }
    try {
      const [{ songs, issues }, { playlists }] = await Promise.all([
        scanFolder(folder),
        getPlaylists(folder),
      ]);
      set({ songs, playlists, issues, loading: false, error: null });
    } catch (e) {
      set({
        songs: [],
        playlists: [],
        issues: null,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  deleteIssueFiles: async (paths) => {
    const folder = get().settings.musicFolder;
    if (!folder || paths.length === 0) return;
    const { songs, issues } = await resolveLibraryIssues(folder, paths);
    set({ songs, issues });
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
