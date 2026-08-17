import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useLibrary } from "@/store/library";
import { cn } from "@/lib/utils";

/** The "Like" feature is just the existing playlist system pointed at one well-known
 * playlist — no new DB table, no new API. Liking a song adds it to (and auto-creates)
 * this playlist; unliking removes it. */
export const FAVORITES_PLAYLIST = "Favorites";

export function useIsLiked(songPath: string) {
  return useLibrary((s) => {
    const favorites = s.playlists.find((p) => p.name === FAVORITES_PLAYLIST);
    return !!favorites && favorites.songs.includes(songPath);
  });
}

export function toggleLike(songPath: string) {
  const { playlists, addPlaylist, addSongToPlaylist, removeSongFromPlaylist } =
    useLibrary.getState();
  const favorites = playlists.find((p) => p.name === FAVORITES_PLAYLIST);
  if (favorites?.songs.includes(songPath)) {
    removeSongFromPlaylist(FAVORITES_PLAYLIST, songPath);
    return;
  }
  // addPlaylist's store update is synchronous, so the immediately-following
  // addSongToPlaylist sees the new (possibly still-empty) playlist right away.
  if (!favorites) addPlaylist(FAVORITES_PLAYLIST);
  addSongToPlaylist(FAVORITES_PLAYLIST, songPath);
}

export function LikeButton({
  songPath,
  size = "md",
  className,
}: {
  songPath: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const liked = useIsLiked(songPath);
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.85 }}
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(songPath);
      }}
      aria-label={liked ? "Remove from Favorites" : "Add to Favorites"}
      className={cn(
        "grid place-items-center rounded-lg transition-colors",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        liked ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Heart className={cn(size === "sm" ? "h-4 w-4" : "h-5 w-5", liked && "fill-current")} />
    </motion.button>
  );
}
