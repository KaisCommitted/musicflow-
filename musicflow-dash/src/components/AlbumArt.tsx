import { Music2 } from "lucide-react";
import type { Song } from "@/lib/api";
import { gradientFromString } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function AlbumArt({
  song,
  className,
  iconClassName,
}: {
  song: Pick<Song, "album" | "title" | "artwork"> | null;
  className?: string;
  iconClassName?: string;
}) {
  if (!song) {
    return (
      <div className={cn("grid place-items-center bg-muted", className)}>
        <Music2 className={cn("h-4 w-4 text-muted-foreground", iconClassName)} />
      </div>
    );
  }
  if (song.artwork) {
    return (
      <img
        src={song.artwork}
        alt={`${song.album || song.title} cover art`}
        loading="lazy"
        className={cn("object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn("grid place-items-center", className)}
      style={{ backgroundImage: gradientFromString(song.album || song.title) }}
      aria-label={`${song.album || song.title} placeholder art`}
    >
      <Music2 className={cn("h-4 w-4 text-foreground/70", iconClassName)} />
    </div>
  );
}
