import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Play, Volume2 } from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
import { useLibrary } from "@/store/library";
import { usePlayer, type PlayContext } from "@/store/player";
import { useSongMenu } from "@/store/menu";
import { colorFromString } from "@/lib/colors";
import { formatTime } from "@/lib/format";
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
      <ul>
        {sorted.map((song, i) => {
          const active = current?.id === song.id;
          return (
            <li
              key={`${song.id}-${i}`}
              onDoubleClick={() => playQueue(sorted, i, context)}
              onContextMenu={(e) => {
                e.preventDefault();
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
                "group grid cursor-default grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_70px] items-center gap-4 px-4 py-2 hover-row",
                active && "bg-primary/10",
              )}
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
                  {active && isPlaying ? (
                    <Volume2 className="h-4 w-4 text-primary" />
                  ) : (
                    i + 1
                  )}
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
