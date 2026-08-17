import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Play, Volume2 } from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
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
        <div className="grid grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_70px] items-center gap-4 border-b border-border px-4 py-2.5">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">#</span>
          {header("title", "Title")}
          {header("artist", "Artist")}
          {header("album", "Album")}
          {header("duration", "Time", "justify-end")}
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
                "group grid cursor-default grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_70px] items-center gap-4 px-4 py-2 hover-row absolute top-0 left-0 w-full",
                active && "bg-primary/10",
              )}
              style={{
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              <span className="grid h-8 w-8 place-items-center text-xs tabular-nums text-muted-foreground">
                <button
                  onClick={() => playQueue(sorted, i, context)}
                  aria-label={`Play ${song.title}`}
                  className="hidden group-hover:block"
                >
                  <Play className="h-4 w-4 text-primary" />
                </button>
                <span className="group-hover:hidden">
                  {active && isPlaying ? <Volume2 className="h-4 w-4 text-primary" /> : i + 1}
                </span>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
