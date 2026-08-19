import { create } from "zustand";
import {
  createPlaylist as apiCreatePlaylist,
  deletePlaylist as apiDeletePlaylist,
  deleteSong as apiDeleteSong,
  updatePlaylist as apiUpdatePlaylist,
  getPlaylists,
  getSettings,
  resolveLibraryIssues,
  saveSettings,
  scanFolder,
  type LibraryIssuesReport,
  type Playlist,
  type Song,
} from "@/lib/api";
import { isUiScale, type UiScale } from "@/lib/uiScale";
import type { KeybindGlobalMode } from "@/lib/keybinds";

/** Result of trying to create one playlist — used by both creation modes to report
 * per-playlist success/failure (a text paste can define several at once). */
export interface CreatePlaylistResult {
  name: string;
  ok: boolean;
  error?: string;
}

export interface Settings {
  musicFolder: string;
  theme: "dark" | "light";
  uiScale: UiScale;
  crossfade: number;
  showPlaylistTags: boolean;
  autoScanOnStart: boolean;
  gaplessPlayback: boolean;
  fetchLyricsAutomatically: boolean;
  /** When true, the full-screen player treats unsynced (plain, no timing data) lyrics as if
   * there were none — showing the centered thumbnail view instead. */
  hideUnsyncedLyrics: boolean;
  /** JSON-encoded Record<KeybindActionId, string>; "" means defaults. */
  keybinds: string;
  /** Whether Playback keybinds also work while Musicflow isn't focused (Electron only). */
  keybindGlobalMode: KeybindGlobalMode;
  /** JSON-encoded KeybindActionId[] — which ones are global when keybindGlobalMode is "custom". */
  globalKeybinds: string;
  /** JSON-encoded CustomVolumeKeybind[] — user-defined "jump to X% volume" shortcuts. */
  customVolumeKeybinds: string;
  /** Discord's Client ID is baked into the backend (discord_rpc.py) — it identifies the
   * Musicflow app to Discord, not any one Discord account, so there's nothing to configure. */
  discordEnabled: boolean;
  scrobblingEnabled: boolean;
  /** Personal API token from listenbrainz.org/profile. */
  listenbrainzToken: string;
  /** Set server-side once the token is validated — empty means not connected. */
  listenbrainzUsername: string;
  lastfmEnabled: boolean;
  /** Set server-side once the browser-authorization flow completes — empty means not
   * connected. The session key itself never round-trips to the frontend, only this. */
  lastfmUsername: string;
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
  /** Deletes a song's file, its lyrics sidecars, and removes it from every playlist. */
  deleteSong: (path: string) => Promise<{ ok: boolean; error?: string }>;
  addPlaylist: (name: string) => void;
  removePlaylist: (name: string) => void;
  addSongToPlaylist: (name: string, songPath: string) => void;
  removeSongFromPlaylist: (name: string, songPath: string) => void;
  /** Same as the singular versions, but one rewrite of the .m3u8 for the whole batch instead
   * of one per song — what a bulk-select "add N songs to a playlist" action should use. */
  addSongsToPlaylist: (name: string, songPaths: string[]) => void;
  removeSongsFromPlaylist: (name: string, songPaths: string[]) => void;
  playlistsForSong: (songPath: string) => string[];
  /** Creates one playlist pre-filled with the given songs (the "pick songs" UI). */
  createPlaylistWithSongs: (name: string, songPaths: string[]) => Promise<CreatePlaylistResult>;
  /** Creates several playlists at once (the "paste text" UI) — one result per block,
   * in order, so the caller can show which ones landed and which didn't. */
  createPlaylistsFromBlocks: (
    blocks: { name: string; songPaths: string[] }[],
  ) => Promise<CreatePlaylistResult[]>;
}

const defaultSettings: Settings = {
  musicFolder: "",
  theme: "dark",
  uiScale: "small",
  crossfade: 0,
  showPlaylistTags: true,
  autoScanOnStart: true,
  gaplessPlayback: true,
  fetchLyricsAutomatically: true,
  hideUnsyncedLyrics: false,
  keybinds: "",
  keybindGlobalMode: "off",
  globalKeybinds: "[]",
  customVolumeKeybinds: "[]",
  discordEnabled: false,
  scrobblingEnabled: false,
  listenbrainzToken: "",
  listenbrainzUsername: "",
  lastfmEnabled: false,
  lastfmUsername: "",
};

function parseSettings(raw: Record<string, string>): Settings {
  return {
    musicFolder: raw["musicFolder"] ?? "",
    theme: (raw["theme"] as "dark" | "light") ?? "dark",
    uiScale: isUiScale(raw["uiScale"] ?? "") ? (raw["uiScale"] as UiScale) : "small",
    crossfade: Number(raw["crossfade"] ?? 0),
    showPlaylistTags: raw["showPlaylistTags"] !== "false",
    autoScanOnStart: raw["autoScanOnStart"] !== "false",
    gaplessPlayback: raw["gaplessPlayback"] !== "false",
    fetchLyricsAutomatically: raw["fetchLyricsAutomatically"] !== "false",
    hideUnsyncedLyrics: raw["hideUnsyncedLyrics"] === "true",
    keybinds: raw["keybinds"] ?? "",
    keybindGlobalMode: (["off", "all", "custom"] as const).includes(
      raw["keybindGlobalMode"] as KeybindGlobalMode,
    )
      ? (raw["keybindGlobalMode"] as KeybindGlobalMode)
      : "off",
    globalKeybinds: raw["globalKeybinds"] ?? "[]",
    customVolumeKeybinds: raw["customVolumeKeybinds"] ?? "[]",
    discordEnabled: raw["discordEnabled"] === "true",
    scrobblingEnabled: raw["scrobblingEnabled"] === "true",
    listenbrainzToken: raw["listenbrainzToken"] ?? "",
    listenbrainzUsername: raw["listenbrainzUsername"] ?? "",
    lastfmEnabled: raw["lastfmEnabled"] === "true",
    lastfmUsername: raw["lastfmUsername"] ?? "",
  };
}

function serializeSettings(s: Settings): Record<string, string> {
  return {
    musicFolder: s.musicFolder,
    theme: s.theme,
    uiScale: s.uiScale,
    crossfade: String(s.crossfade),
    showPlaylistTags: String(s.showPlaylistTags),
    autoScanOnStart: String(s.autoScanOnStart),
    gaplessPlayback: String(s.gaplessPlayback),
    fetchLyricsAutomatically: String(s.fetchLyricsAutomatically),
    hideUnsyncedLyrics: String(s.hideUnsyncedLyrics),
    keybinds: s.keybinds,
    keybindGlobalMode: s.keybindGlobalMode,
    globalKeybinds: s.globalKeybinds,
    customVolumeKeybinds: s.customVolumeKeybinds,
    discordEnabled: String(s.discordEnabled),
    scrobblingEnabled: String(s.scrobblingEnabled),
    listenbrainzToken: s.listenbrainzToken,
    listenbrainzUsername: s.listenbrainzUsername,
    lastfmEnabled: String(s.lastfmEnabled),
    lastfmUsername: s.lastfmUsername,
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

  deleteSong: async (path) => {
    const folder = get().settings.musicFolder;
    if (!folder) return { ok: false, error: "No music folder configured" };
    try {
      const { songs } = await apiDeleteSong(folder, path);
      set((s) => ({
        songs,
        playlists: s.playlists.map((p) => ({ ...p, songs: p.songs.filter((sp) => sp !== path) })),
      }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  addPlaylist: (name) => {
    const folder = get().settings.musicFolder;
    if (!folder || get().playlists.some((p) => p.name === name)) return;
    set((s) => ({ playlists: [...s.playlists, { name, songs: [] }] }));
    // Persist in the background; roll back the optimistic add if it fails.
    void apiCreatePlaylist(folder, name).catch(() => {
      set((s) => ({ playlists: s.playlists.filter((p) => p.name !== name) }));
    });
  },

  removePlaylist: (name) => {
    const folder = get().settings.musicFolder;
    const prev = get().playlists;
    set((s) => ({ playlists: s.playlists.filter((p) => p.name !== name) }));
    if (folder) void apiDeletePlaylist(folder, name).catch(() => set({ playlists: prev }));
  },

  addSongToPlaylist: (name, songPath) => {
    const folder = get().settings.musicFolder;
    const target = get().playlists.find((p) => p.name === name);
    if (!folder || !target || target.songs.includes(songPath)) return;
    const songs = [...target.songs, songPath];
    set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? { ...p, songs } : p)) }));
    void apiUpdatePlaylist(folder, name, songs).catch(() => {
      set((s) => ({
        playlists: s.playlists.map((p) => (p.name === name ? target : p)),
      }));
    });
  },

  removeSongFromPlaylist: (name, songPath) => {
    const folder = get().settings.musicFolder;
    const target = get().playlists.find((p) => p.name === name);
    if (!folder || !target) return;
    const songs = target.songs.filter((x) => x !== songPath);
    set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? { ...p, songs } : p)) }));
    void apiUpdatePlaylist(folder, name, songs).catch(() => {
      set((s) => ({
        playlists: s.playlists.map((p) => (p.name === name ? target : p)),
      }));
    });
  },

  addSongsToPlaylist: (name, songPaths) => {
    const folder = get().settings.musicFolder;
    const target = get().playlists.find((p) => p.name === name);
    if (!folder || !target) return;
    const toAdd = songPaths.filter((p) => !target.songs.includes(p));
    if (!toAdd.length) return;
    const songs = [...target.songs, ...toAdd];
    set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? { ...p, songs } : p)) }));
    void apiUpdatePlaylist(folder, name, songs).catch(() => {
      set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? target : p)) }));
    });
  },

  removeSongsFromPlaylist: (name, songPaths) => {
    const folder = get().settings.musicFolder;
    const target = get().playlists.find((p) => p.name === name);
    if (!folder || !target) return;
    const remove = new Set(songPaths);
    const songs = target.songs.filter((x) => !remove.has(x));
    set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? { ...p, songs } : p)) }));
    void apiUpdatePlaylist(folder, name, songs).catch(() => {
      set((s) => ({ playlists: s.playlists.map((p) => (p.name === name ? target : p)) }));
    });
  },

  playlistsForSong: (songPath) =>
    get()
      .playlists.filter((p) => p.songs.includes(songPath))
      .map((p) => p.name),

  createPlaylistWithSongs: async (name, songPaths) => {
    const folder = get().settings.musicFolder;
    if (!folder) return { name, ok: false, error: "No music folder configured" };
    if (get().playlists.some((p) => p.name === name)) {
      return { name, ok: false, error: "A playlist with that name already exists" };
    }
    try {
      await apiCreatePlaylist(folder, name);
      if (songPaths.length) await apiUpdatePlaylist(folder, name, songPaths);
      set((s) => ({ playlists: [...s.playlists, { name, songs: songPaths }] }));
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  createPlaylistsFromBlocks: async (blocks) => {
    const folder = get().settings.musicFolder;
    if (!folder) {
      return blocks.map((b) => ({ name: b.name, ok: false, error: "No music folder configured" }));
    }
    const existing = new Set(get().playlists.map((p) => p.name));
    const created: Playlist[] = [];
    const results: CreatePlaylistResult[] = [];

    for (const b of blocks) {
      if (existing.has(b.name)) {
        results.push({ name: b.name, ok: false, error: "A playlist with that name already exists" });
        continue;
      }
      try {
        await apiCreatePlaylist(folder, b.name);
        if (b.songPaths.length) await apiUpdatePlaylist(folder, b.name, b.songPaths);
        created.push({ name: b.name, songs: b.songPaths });
        existing.add(b.name);
        results.push({ name: b.name, ok: true });
      } catch (e) {
        results.push({ name: b.name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (created.length) set((s) => ({ playlists: [...s.playlists, ...created] }));
    return results;
  },
}));
