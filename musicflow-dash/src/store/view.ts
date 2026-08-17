import { create } from "zustand";

export type LibraryTab = "songs" | "albums" | "artists" | "genres" | "playlists";

interface ViewState {
  tab: LibraryTab;
  album: string | null;
  artist: string | null;
  genre: string | null;
  playlist: string | null;
  /** playlists selected for combined playback */
  selectedPlaylists: string[];
  setTab: (tab: LibraryTab) => void;
  openAlbum: (album: string) => void;
  openArtist: (artist: string) => void;
  openGenre: (genre: string) => void;
  openPlaylist: (playlist: string) => void;
  toggleSelectedPlaylist: (name: string) => void;
  clearSelection: () => void;
  back: () => void;
}

export const useView = create<ViewState>((set) => ({
  tab: "songs",
  album: null,
  artist: null,
  genre: null,
  playlist: null,
  selectedPlaylists: [],
  setTab: (tab) => set({ tab, album: null, artist: null, genre: null, playlist: null }),
  openAlbum: (album) => set({ tab: "albums", album, artist: null, genre: null, playlist: null }),
  openArtist: (artist) => set({ tab: "artists", artist, album: null, genre: null, playlist: null }),
  openGenre: (genre) => set({ tab: "genres", genre, album: null, artist: null, playlist: null }),
  openPlaylist: (playlist) =>
    set({ tab: "playlists", playlist, album: null, artist: null, genre: null }),
  toggleSelectedPlaylist: (name) =>
    set((s) => ({
      selectedPlaylists: s.selectedPlaylists.includes(name)
        ? s.selectedPlaylists.filter((n) => n !== name)
        : [...s.selectedPlaylists, name],
    })),
  clearSelection: () => set({ selectedPlaylists: [] }),
  back: () => set({ album: null, artist: null, genre: null, playlist: null }),
}));
