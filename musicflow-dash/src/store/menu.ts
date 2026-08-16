import { create } from "zustand";
import type { Song } from "@/lib/api";

interface MenuState {
  song: Song | null;
  /** songs currently shown in the view, so "Play Now" can queue the whole context */
  contextSongs: Song[];
  contextLabel: string;
  /** playlist name when the menu is opened inside a playlist view */
  playlistName: string | null;
  x: number;
  y: number;
  open: (payload: {
    song: Song;
    contextSongs: Song[];
    contextLabel: string;
    playlistName?: string | null;
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
  x: 0,
  y: 0,
  open: (p) =>
    set({
      song: p.song,
      contextSongs: p.contextSongs,
      contextLabel: p.contextLabel,
      playlistName: p.playlistName ?? null,
      x: p.x,
      y: p.y,
    }),
  close: () => set({ song: null }),
}));
