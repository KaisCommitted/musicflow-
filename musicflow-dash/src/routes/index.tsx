import { useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Disc3, ListMusic, Music4, Play, Search, Shuffle, User } from "lucide-react";
import { SongTable } from "@/components/SongTable";
import { AlbumsView, ArtistsView, PlaylistsView } from "@/components/library/LibraryPanels";
import { useLibrary } from "@/store/library";
import { usePlayer } from "@/store/player";
import { useView, type LibraryTab } from "@/store/view";
import { gradientFromString } from "@/lib/colors";
import { ScrollContainerContext } from "@/lib/scrollContainer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: LibraryPage,
});

const TABS: Array<{ key: LibraryTab; label: string; icon: typeof Music4 }> = [
  { key: "songs", label: "All Songs", icon: Music4 },
  { key: "albums", label: "Albums", icon: Disc3 },
  { key: "artists", label: "Artists", icon: User },
  { key: "playlists", label: "Playlists", icon: ListMusic },
];

function LibraryPage() {
  const { songs, playlists, loading, search, setSearch } = useLibrary();
  const { tab, setTab, openAlbum, openArtist, openPlaylist } = useView();
  const playQueue = usePlayer((s) => s.playQueue);
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = search.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const matchSongs = songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q),
    );
    // Capped like songs above — a broad query (e.g. a single common letter) against a library
    // with hundreds/thousands of distinct album or artist tags could otherwise render just as
    // many uncapped result buttons.
    return {
      songs: matchSongs.slice(0, 30),
      albums: [
        ...new Set(songs.filter((s) => s.album.toLowerCase().includes(q)).map((s) => s.album)),
      ].slice(0, 30),
      artists: [
        ...new Set(songs.filter((s) => s.artist.toLowerCase().includes(q)).map((s) => s.artist)),
      ].slice(0, 30),
      playlists: playlists
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => p.name)
        .slice(0, 30),
    };
  }, [q, songs, playlists]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search songs, albums, artists, playlists…"
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              if (songs.length)
                playQueue(
                  [...songs].sort(() => Math.random() - 0.5),
                  0,
                  { label: "All Songs", kind: "all" },
                );
            }}
            className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs transition-colors hover:border-primary hover:text-primary"
          >
            <Shuffle className="h-3.5 w-3.5" /> Shuffle all
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <ScrollContainerContext.Provider value={scrollRef}>
          {results ? (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground">
                  Songs
                </h2>
                <SongTable
                  songs={results.songs}
                  context={{ label: `Search: ${search}`, kind: "search" }}
                />
              </section>
              {(["albums", "artists", "playlists"] as const).map((group) => {
                const items = results[group];
                if (!items.length) return null;
                return (
                  <section key={group}>
                    <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground">
                      {group}
                    </h2>
                    <div className="flex flex-wrap gap-3">
                      {items.map((name) => (
                        <button
                          key={name}
                          onClick={() => {
                            setSearch("");
                            if (group === "albums") openAlbum(name);
                            else if (group === "artists") openArtist(name);
                            else openPlaylist(name);
                          }}
                          className="surface flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:border-primary"
                        >
                          <span
                            className="h-8 w-8 rounded-md"
                            style={{ backgroundImage: gradientFromString(name) }}
                          />
                          {name}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-2">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={cn(
                      "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                      tab === key && "text-primary",
                    )}
                  >
                    {tab === key && (
                      <motion.span
                        layoutId="library-tab-pill"
                        className="absolute inset-0 rounded-full bg-primary/15"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    )}
                    <Icon className="relative z-10 h-4 w-4" />
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() =>
                    songs.length && playQueue(songs, 0, { label: "All Songs", kind: "all" })
                  }
                  className="ml-auto flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow"
                >
                  <Play className="h-3.5 w-3.5" /> Play all
                </motion.button>
              </div>

              {loading && <p className="text-sm text-muted-foreground">Scanning library…</p>}

              {/* popLayout, not wait: "wait" fully removes the old tab before mounting the
                  new one, which — with hundreds of songs/albums/artists — is slow enough
                  to read as a blank flicker. popLayout takes the exiting tab out of layout
                  flow so the new one renders immediately underneath while the old one
                  fades out on top, with no gap and no layout jump. */}
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  {tab === "songs" && (
                    <SongTable songs={songs} context={{ label: "All Songs", kind: "all" }} />
                  )}
                  {tab === "albums" && <AlbumsView songs={songs} />}
                  {tab === "artists" && <ArtistsView songs={songs} />}
                  {tab === "playlists" && <PlaylistsView songs={songs} />}
                </motion.div>
              </AnimatePresence>
            </>
          )}
        </ScrollContainerContext.Provider>
      </div>
    </div>
  );
}
