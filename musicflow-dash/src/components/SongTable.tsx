import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Heart,
  ListEnd,
  Play,
  Plus,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
import { LikeButton, toggleLikeMany } from "@/components/LikeButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLibrary } from "@/store/library";
import { usePlayer, type PlayContext } from "@/store/player";
import { useSongMenu } from "@/store/menu";
import { colorFromString } from "@/lib/colors";
import { formatTime } from "@/lib/format";
import { useScrollContainer } from "@/lib/scrollContainer";
import { cn } from "@/lib/utils";

type SortKey = "index" | "title" | "artist" | "album" | "duration";

export function PlaylistTags({ song }: { song: Song }) {
  const showTags = useLibrary((s) => s.settings.showPlaylistTags);
  const playlists = useLibrary((s) => s.playlists);
  const names = useMemo(
    () => playlists.filter((p) => p.songs.includes(song.path)).map((p) => p.name),
    [playlists, song.path],
  );
  if (!showTags || names.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-full px-2 py-[1px] text-[10px] font-semibold"
          style={{
            color: colorFromString(n),
            backgroundColor: `color-mix(in oklab, ${colorFromString(n)} 18%, transparent)`,
          }}
        >
          {n}
        </span>
      ))}
    </span>
  );
}

/** Floating pill for a multi-select — mirrors PlaylistsView's "Play Selected" bar. */
function BulkActionsBar({
  selectedSongs,
  playlistName,
  onClear,
}: {
  selectedSongs: Song[];
  playlistName: string | null;
  onClear: () => void;
}) {
  const playQueue = usePlayer((s) => s.playQueue);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const playlists = useLibrary((s) => s.playlists);
  const addPlaylist = useLibrary((s) => s.addPlaylist);
  const addSongsToPlaylist = useLibrary((s) => s.addSongsToPlaylist);
  const removeSongsFromPlaylist = useLibrary((s) => s.removeSongsFromPlaylist);
  const deleteSong = useLibrary((s) => s.deleteSong);
  const [deleting, setDeleting] = useState(false);
  const paths = useMemo(() => selectedSongs.map((s) => s.path), [selectedSongs]);
  const allLiked =
    paths.length > 0 &&
    paths.every((p) => playlists.find((pl) => pl.name === "Favorites")?.songs.includes(p));

  const bulkDelete = async () => {
    const ok = window.confirm(
      `Permanently delete ${selectedSongs.length} song${selectedSongs.length === 1 ? "" : "s"}? This removes the files, their metadata, and their lyrics from disk — it can't be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    // Sequential, not Promise.all — each call replaces the store's whole `songs` array with
    // the backend's post-delete list, so running them in parallel would race and could drop
    // updates from all but the last response to land.
    for (const p of paths) await deleteSong(p);
    setDeleting(false);
    onClear();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      className="pointer-events-none fixed inset-x-0 bottom-32 z-40 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card px-2 py-2 shadow-elevated">
        <span className="px-3 text-xs font-medium text-muted-foreground">
          {selectedSongs.length} selected
        </span>
        <button
          onClick={() => selectedSongs.length && playQueue(selectedSongs, 0, { label: "Selection", kind: "all" })}
          aria-label="Play selection"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Play className="h-4 w-4" />
        </button>
        <button
          onClick={() => addToQueue(selectedSongs)}
          aria-label="Add selection to queue"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ListEnd className="h-4 w-4" />
        </button>
        <button
          onClick={() => toggleLikeMany(paths)}
          aria-label={allLiked ? "Remove selection from Favorites" : "Add selection to Favorites"}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-accent",
            allLiked ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart className={cn("h-4 w-4", allLiked && "fill-current")} />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label="Add selection to playlist"
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-56">
            {playlists.map((p) => {
              const allIn = paths.every((path) => p.songs.includes(path));
              return (
                <button
                  key={p.name}
                  onClick={() => addSongsToPlaylist(p.name, paths)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <Check className={cn("h-3.5 w-3.5 text-primary", !allIn && "invisible")} />
                  {p.name}
                </button>
              );
            })}
            {playlists.length > 0 && <div className="my-1 h-px bg-border" />}
            <button
              onClick={() => {
                const name = window.prompt("New playlist name");
                if (name) {
                  addPlaylist(name);
                  addSongsToPlaylist(name, paths);
                }
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Create New…
            </button>
          </PopoverContent>
        </Popover>
        {playlistName && (
          <button
            onClick={() => {
              removeSongsFromPlaylist(playlistName, paths);
              onClear();
            }}
            aria-label={`Remove selection from ${playlistName}`}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => void bulkDelete()}
          disabled={deleting}
          aria-label="Delete selection"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-border" />
        <button
          onClick={onClear}
          aria-label="Clear selection"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}

export function SongTable({
  songs,
  context,
  playlistName = null,
  showHeader = true,
}: {
  songs: Song[];
  context: PlayContext;
  playlistName?: string | null;
  showHeader?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "index", dir: 1 });
  const playQueue = usePlayer((s) => s.playQueue);
  const openMenu = useSongMenu((s) => s.open);
  const current = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);

  // Multi-select — local to this table instance (each tab/album/playlist mounts its own
  // SongTable), so switching views naturally clears it instead of needing its own reset logic.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorIndex = useRef<number | null>(null);
  const selectionActive = selected.size > 0;

  // Only the rows scrolled into view get mounted — with 900+ songs, rendering every
  // row unconditionally is what makes the library heavy to paint (e.g. noticeably
  // laggy closing the full-screen player back down to it). The list doesn't own its
  // own scrollbar; it measures against the page-level scroll container from
  // ScrollContainerContext so header/meta content above it keeps scrolling together
  // with the table, same as before virtualization.
  const scrollRef = useScrollContainer();
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const sorted = useMemo(() => {
    if (sort.key === "index") return songs;
    const copy = [...songs];
    copy.sort((a, b) => {
      const av = a[sort.key as "title" | "artist" | "album" | "duration"];
      const bv = b[sort.key as "title" | "artist" | "album" | "duration"];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return copy;
  }, [songs, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }));

  /** Plain click toggles just this row (and becomes the range anchor). Shift+click selects
   * every row between the anchor and here, matching Explorer/Gmail-style multi-select. */
  const toggleSelect = (i: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorIndex.current != null) {
        const [lo, hi] =
          anchorIndex.current < i ? [anchorIndex.current, i] : [i, anchorIndex.current];
        for (let k = lo; k <= hi; k++) next.add(sorted[k]!.path);
        return next;
      }
      const path = sorted[i]!.path;
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!shiftKey) anchorIndex.current = i;
  };

  // Re-measure how far the list sits from the top of the scroll container whenever
  // the page around it changes size — switching tabs, drilling into an album, the
  // UI-scale slider, etc. all shift that offset.
  useLayoutEffect(() => {
    const measure = () => setScrollMargin(listRef.current?.offsetTop ?? 0);
    measure();
    const container = scrollRef?.current;
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollRef, showHeader]);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 56,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => `${sorted[index]!.id}-${index}`,
  });

  const header = (key: SortKey, label: string, className?: string) => (
    <button
      onClick={() => toggleSort(key)}
      className={cn(
        "flex items-center gap-1 text-left text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {label}
      {sort.key === key &&
        (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  if (!songs.length) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No songs here yet.</p>;
  }

  return (
    <div className="surface overflow-hidden">
      {showHeader && (
        <div className="grid grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_70px_44px] items-center gap-4 border-b border-border px-4 py-2.5">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">#</span>
          {header("title", "Title")}
          {header("artist", "Artist")}
          {header("album", "Album")}
          {header("duration", "Time", "justify-end")}
          <span aria-hidden="true" />
        </div>
      )}
      <ul ref={listRef} className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const i = virtualRow.index;
          const song = sorted[i]!;
          const active = current?.id === song.id;
          return (
            <li
              key={virtualRow.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              onClick={(e) => {
                // Ctrl/Cmd or Shift click multi-selects like a file manager — the entry point
                // into selection mode; once any row is selected, a checkbox appears on hover
                // for mouse-only extension (see the index cell above).
                if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(i, e.shiftKey);
              }}
              onDoubleClick={() => playQueue(sorted, i, context)}
              onContextMenu={(e) => {
                e.preventDefault();
                // Without this, the native event keeps bubbling to the window-level
                // "contextmenu" listener SongContextMenu uses to close on outside-clicks,
                // which would close the menu in the same tick it just opened in.
                e.stopPropagation();
                openMenu({
                  song,
                  contextSongs: sorted,
                  contextLabel: context.label,
                  playlistName,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              className={cn(
                "group grid cursor-default grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_70px_44px] items-center gap-4 px-4 py-2 hover-row absolute top-0 left-0 w-full",
                (active || selected.has(song.path)) && "bg-primary/10",
              )}
              style={{
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              <span className="grid h-8 w-8 place-items-center text-xs tabular-nums text-muted-foreground">
                {selected.has(song.path) ? (
                  <input
                    type="checkbox"
                    checked
                    onChange={() => {}}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(i, e.shiftKey);
                    }}
                    aria-label={`Deselect ${song.title}`}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                ) : selectionActive ? (
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => {}}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(i, e.shiftKey);
                    }}
                    aria-label={`Select ${song.title}`}
                    className="hidden h-4 w-4 cursor-pointer accent-primary group-hover:block"
                  />
                ) : (
                  <button
                    onClick={() => playQueue(sorted, i, context)}
                    aria-label={`Play ${song.title}`}
                    className="hidden group-hover:grid group-hover:place-items-center"
                  >
                    {active && isPlaying ? (
                      <Volume2 className="h-4 w-4 text-primary" />
                    ) : (
                      <Play className="h-4 w-4 text-primary" />
                    )}
                  </button>
                )}
              </span>
              <div className="flex min-w-0 items-center gap-3">
                <AlbumArt song={song} className="h-9 w-9 shrink-0 rounded-md" />
                <div className="min-w-0">
                  <p className={cn("truncate text-sm", active && "font-semibold text-primary")}>
                    {song.title}
                  </p>
                  <PlaylistTags song={song} />
                </div>
              </div>
              <span className="truncate text-sm text-muted-foreground">{song.artist}</span>
              <span className="truncate text-sm text-muted-foreground">{song.album}</span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {formatTime(song.duration)}
              </span>
              <LikeButton songPath={song.path} size="sm" className="justify-self-center" />
            </li>
          );
        })}
      </ul>
      <AnimatePresence>
        {selectionActive && (
          <BulkActionsBar
            selectedSongs={sorted.filter((s) => selected.has(s.path))}
            playlistName={playlistName}
            onClear={() => setSelected(new Set())}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
