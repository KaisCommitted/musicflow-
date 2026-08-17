import { User } from "lucide-react";
import type { Song } from "@/lib/api";
import { gradientFromString } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** An artist's picture is just their first song's cover art. */
export function ArtistArt({
  name,
  tracks,
  className,
  iconClassName,
}: {
  name: string;
  tracks: Song[];
  className?: string;
  iconClassName?: string;
}) {
  const artwork = tracks[0]?.artwork;
  if (artwork) {
    return (
      <img
        src={artwork}
        alt={`${name} artist art`}
        loading="lazy"
        className={cn("object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn("grid place-items-center", className)}
      style={{ backgroundImage: gradientFromString(name) }}
      aria-label={`${name} placeholder art`}
    >
      <User className={cn("text-foreground/80", iconClassName)} />
    </div>
  );
}
