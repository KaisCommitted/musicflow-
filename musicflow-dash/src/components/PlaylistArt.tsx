import { useMemo } from "react";
import { ListMusic } from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
import { gradientFromString } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** Deterministic shuffle seeded by the playlist name — the "random" 4 songs stay the
 * same across re-renders instead of reshuffling every time the component updates. */
function pickFour(songs: Song[], seed: string): Song[] {
  if (songs.length === 0) return [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const next = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
  const shuffled = [...songs].sort(() => next() - 0.5);
  // shuffled is non-empty (guarded above), so the modulo index always lands in range
  return Array.from({ length: 4 }, (_, i) => shuffled[i % shuffled.length]!);
}

/** A playlist's picture is a 2x2 collage of 4 random songs' cover art. */
export function PlaylistArt({
  name,
  songs,
  className,
  iconClassName,
}: {
  name: string;
  songs: Song[];
  className?: string;
  iconClassName?: string;
}) {
  const tiles = useMemo(() => pickFour(songs, name), [songs, name]);

  if (tiles.length === 0) {
    return (
      <div
        className={cn("grid place-items-center", className)}
        style={{ backgroundImage: gradientFromString(name) }}
        aria-label={`${name} placeholder art`}
      >
        <ListMusic className={cn("text-foreground/80", iconClassName)} />
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 grid-rows-2 overflow-hidden", className)}>
      {tiles.map((song, i) => (
        <AlbumArt
          key={`${song.id}-${i}`}
          song={song}
          className="h-full w-full"
          iconClassName="h-4 w-4"
        />
      ))}
    </div>
  );
}
