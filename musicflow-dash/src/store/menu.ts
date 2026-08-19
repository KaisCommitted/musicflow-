import { create } from "zustand";
import type { Song } from "@/lib/api";

interface MenuState {
  song: Song | null;
  /** songs currently shown in the view, so "Play Now" can queue the whole context */
  contextSongs: Song[];
  contextLabel: string;
  /** playlist name when the menu is opened inside a playlist view */
  playlistName: string | null;
  /** whether `song` is part of the caller's current multi-selection, so the menu can offer
   * "Select"/"Deselect" as an entry point into bulk actions for users who haven't found
   * Ctrl/Shift+click. */
  selected: boolean;
  onToggleSelect: () => void;
  x: number;
  y: number;
  open: (payload: {
    song: Song;
    contextSongs: Song[];
    contextLabel: string;
    playlistName?: string | null;
    selected: boolean;
    onToggleSelect: () => void;
    x: number;
    y: number;
  }) => void;
  close: () => void;
}

export const useSongMenu = create<MenuState>((set) => ({
  song: null,
  contextSongs: [],
  contextLabel: "All Songs",
  playlistName: null,
  selected: false,
  onToggleSelect: () => {},
  x: 0,
  y: 0,
  open: (p) =>
    set({
      song: p.song,
      contextSongs: p.contextSongs,
      contextLabel: p.contextLabel,
      playlistName: p.playlistName ?? null,
      selected: p.selected,
      onToggleSelect: p.onToggleSelect,
      x: p.x,
      y: p.y,
    }),
  close: () => set({ song: null }),
}));
