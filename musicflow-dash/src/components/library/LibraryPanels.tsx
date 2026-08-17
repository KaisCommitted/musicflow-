import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Disc3, Play, Plus, Trash2 } from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
import { ArtistArt } from "@/components/ArtistArt";
import { PlaylistArt } from "@/components/PlaylistArt";
import { SongTable } from "@/components/SongTable";
import { CreatePlaylistDialog } from "@/components/library/CreatePlaylistDialog";
import { useLibrary } from "@/store/library";
import { usePlayer } from "@/store/player";
import { useView } from "@/store/view";
import { cn } from "@/lib/utils";

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-4 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

function PlayBigButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
    >
      <Play className="h-4 w-4" /> Play
    </motion.button>
  );
}

/* --------------------------------- Albums --------------------------------- */

export function AlbumsView({ songs }: { songs: Song[] }) {
  const { album, openAlbum, back } = useView();
  const playQueue = usePlayer((s) => s.playQueue);

  const albums = useMemo(() => {
    const map = new Map<string, Song[]>();
    for (const s of songs) {
      const list = map.get(s.album) ?? [];
      list.push(s);
      map.set(s.album, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  if (album) {
    const tracks = songs.filter((s) => s.album === album);
    const first = tracks[0];
    return (
      <div>
        <BackButton label="All albums" onClick={back} />
        <div className="mb-6 flex items-end gap-6">
          <AlbumArt
            song={first ?? null}
            className="h-40 w-40 rounded-2xl shadow-elevated"
            iconClassName="h-8 w-8"
          />
          <div className="pb-2">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Album</p>
            <h2 className="mt-1 text-3xl font-bold">{album}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {first?.artist} · {tracks.length} tracks
            </p>
            <div className="mt-4">
              <PlayBigButton
                onClick={() => playQueue(tracks, 0, { label: album, kind: "album" })}
              />
            </div>
          </div>
        </div>
        <SongTable songs={tracks} context={{ label: album, kind: "album" }} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
      {albums.map(([name, tracks], i) => (
        <motion.button
          key={name}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.02, 0.3) }}
          whileTap={{ scale: 0.97 }}
          onClick={() => openAlbum(name)}
          className="surface group overflow-hidden p-3 text-left transition-all hover:-translate-y-1 hover:shadow-elevated"
        >
          <AlbumArt
            song={tracks[0] ?? null}
            className="mb-3 aspect-square w-full rounded-xl"
            iconClassName="h-7 w-7"
          />
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{tracks[0]?.artist}</p>
        </motion.button>
      ))}
    </div>
  );
}

/* --------------------------------- Artists -------------------------------- */

export function ArtistsView({ songs }: { songs: Song[] }) {
  const { artist, openArtist, openAlbum, back } = useView();
  const playQueue = usePlayer((s) => s.playQueue);

  const artists = useMemo(() => {
    const map = new Map<string, Song[]>();
    for (const s of songs) {
      const list = map.get(s.artist) ?? [];
      list.push(s);
      map.set(s.artist, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  if (artist) {
    const tracks = songs.filter((s) => s.artist === artist);
    const albums = [...new Set(tracks.map((t) => t.album))];
    return (
      <div>
        <BackButton label="All artists" onClick={back} />
        <div className="mb-6 flex items-center gap-6">
          <ArtistArt
            name={artist}
            tracks={tracks}
            className="h-32 w-32 rounded-full shadow-elevated"
            iconClassName="h-10 w-10"
          />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Artist</p>
            <h2 className="mt-1 text-3xl font-bold">{artist}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {albums.length} albums · {tracks.length} tracks
            </p>
            <div className="mt-4">
              <PlayBigButton
                onClick={() => playQueue(tracks, 0, { label: artist, kind: "artist" })}
              />
            </div>
          </div>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          {albums.map((a) => (
            <button
              key={a}
              onClick={() => openAlbum(a)}
              className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
            >
              <Disc3 className="h-3.5 w-3.5" /> {a}
            </button>
          ))}
        </div>
        <SongTable songs={tracks} context={{ label: artist, kind: "artist" }} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
      {artists.map(([name, tracks], i) => (
        <motion.button
          key={name}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.02, 0.3) }}
          whileTap={{ scale: 0.97 }}
          onClick={() => openArtist(name)}
          className="surface flex flex-col items-center gap-3 p-5 transition-all hover:-translate-y-1 hover:shadow-elevated"
        >
          <ArtistArt
            name={name}
            tracks={tracks}
            className="h-24 w-24 rounded-full"
            iconClassName="h-8 w-8"
          />
          <span className="w-full truncate text-center text-sm font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">{tracks.length} tracks</span>
        </motion.button>
      ))}
    </div>
  );
}

/* -------------------------------- Playlists -------------------------------- */

export function PlaylistsView({ songs }: { songs: Song[] }) {
  const {
    playlist,
    openPlaylist,
    back,
    selectedPlaylists,
    toggleSelectedPlaylist,
    clearSelection,
  } = useView();
  const { playlists, removePlaylist } = useLibrary();
  const playQueue = usePlayer((s) => s.playQueue);
  const [createOpen, setCreateOpen] = useState(false);

  if (playlist) {
    const p = playlists.find((x) => x.name === playlist);
    const tracks = songs.filter((s) => p?.songs.includes(s.path));
    return (
      <div>
        <BackButton label="All playlists" onClick={back} />
        <div className="mb-6 flex items-end gap-6">
          <PlaylistArt
            name={playlist}
            songs={tracks}
            className="h-40 w-40 rounded-2xl shadow-elevated"
            iconClassName="h-10 w-10"
          />
          <div className="pb-2">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Playlist</p>
            <h2 className="mt-1 text-3xl font-bold">{playlist}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tracks.length} tracks</p>
            <div className="mt-4 flex gap-3">
              <PlayBigButton
                onClick={() => playQueue(tracks, 0, { label: playlist, kind: "playlist" })}
              />
              <button
                onClick={() => {
                  removePlaylist(playlist);
                  back();
                }}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>
        <SongTable
          songs={tracks}
          context={{ label: playlist, kind: "playlist" }}
          playlistName={playlist}
        />
      </div>
    );
  }

  const combined = songs.filter((s) =>
    playlists.some((p) => selectedPlaylists.includes(p.name) && p.songs.includes(s.path)),
  );

  return (
    <div>
      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} songs={songs} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setCreateOpen(true)}
          className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03]"
        >
          <Plus className="h-4 w-4" /> Create Playlist
        </button>
        {selectedPlaylists.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedPlaylists.length} selected · {combined.length} tracks
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
        {playlists.map((p, i) => {
          const selected = selectedPlaylists.includes(p.name);
          const tracks = songs.filter((s) => p.songs.includes(s.path));
          return (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3) }}
              className={cn(
                "surface group relative p-4 transition-all hover:-translate-y-1 hover:shadow-elevated",
                selected && "border-primary",
              )}
            >
              <label
                className="absolute right-6 top-6 z-10 flex cursor-pointer items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSelectedPlaylist(p.name)}
                  aria-label={`Select playlist ${p.name}`}
                  className="h-5 w-5 cursor-pointer accent-primary"
                />
              </label>
              <button onClick={() => openPlaylist(p.name)} className="w-full text-left">
                <PlaylistArt
                  name={p.name}
                  songs={tracks}
                  className="mb-3 aspect-square w-full rounded-xl"
                  iconClassName="h-8 w-8"
                />
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{p.songs.length} tracks</span>
              </button>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedPlaylists.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="pointer-events-none fixed inset-x-0 bottom-32 z-40 flex justify-center"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() =>
                combined.length &&
                playQueue(combined, 0, {
                  label: selectedPlaylists.join(" + "),
                  kind: "playlist",
                })
              }
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <Play className="h-4 w-4" /> Play Selected · {combined.length} tracks
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
