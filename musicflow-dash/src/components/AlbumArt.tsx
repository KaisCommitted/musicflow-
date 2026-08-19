import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { ARTWORK_SIZES, withArtworkSize, type Song } from "@/lib/api";
import { gradientFromString } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function AlbumArt({
  song,
  className,
  iconClassName,
  size = "thumb",
}: {
  song: Pick<Song, "album" | "title" | "artwork"> | null;
  className?: string;
  iconClassName?: string;
  /** "large" for anything shown much bigger than a row/grid thumbnail (album/artist/playlist
   * headers, the full-screen player) — requests a bigger downscale so it doesn't look soft. */
  size?: keyof typeof ARTWORK_SIZES;
}) {
  // Resets whenever the artwork itself changes — covers both a fresh mount (a new row
  // scrolling into a virtualized list) and an existing instance switching to a new
  // song (the player bar/full-screen art), so every real image fades in rather than
  // popping in the instant it's decoded.
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setLoaded(false);
    // A browser-cached image (e.g. skipping back to a song shown a moment ago) can finish
    // loading before this effect's onLoad listener is even attached — the "load" event only
    // fires once, so a missed one left the art stuck at opacity-0 until something else (like
    // closing and reopening the full-screen player) forced a fresh element. `complete` is a
    // live property of the element itself, not an event, so it can't be missed the same way.
    if (imgRef.current?.complete) setLoaded(true);
  }, [song?.artwork]);

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
        ref={imgRef}
        src={withArtworkSize(song.artwork, ARTWORK_SIZES[size])}
        alt={`${song.album || song.title} cover art`}
        // "large" is only ever the single hero image the user is looking straight at (album
        // art headers, the full-screen/now-playing view) — never off-screen, so lazy-loading
        // it only adds a heuristic-timing risk with no benefit. Row/grid thumbnails still lazy
        // load, which is what actually matters for a long virtualized list.
        loading={size === "large" ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        className={cn(
          "object-cover opacity-0 transition-opacity duration-300",
          loaded && "opacity-100",
          className,
        )}
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
