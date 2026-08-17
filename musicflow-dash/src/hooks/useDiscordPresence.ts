import { useEffect } from "react";
import { usePlayer } from "@/store/player";
import { useLibrary } from "@/store/library";
import { clearDiscordPresence, updateDiscordPresence } from "@/lib/api";

/** Reports "now playing" to the backend on song-change and play/pause — not on every playback
 * tick — which forwards it to Discord over local IPC if Rich Presence is configured. Entirely
 * a no-op server-side otherwise, so this is safe to always call. */
export function useDiscordPresence() {
  const song = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const discordEnabled = useLibrary((s) => s.settings.discordEnabled);
  const discordClientId = useLibrary((s) => s.settings.discordClientId);

  useEffect(() => {
    if (!discordEnabled || !discordClientId) return;
    if (!song) {
      void clearDiscordPresence().catch(() => undefined);
      return;
    }
    void updateDiscordPresence({
      title: song.title,
      artist: song.artist,
      is_playing: isPlaying,
      position: usePlayer.getState().currentTime,
      duration: song.duration,
    }).catch(() => undefined);
    // song?.id (not the whole song object) + isPlaying are the only things that should
    // re-trigger this — re-reading currentTime fresh above avoids re-running on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, isPlaying, discordEnabled, discordClientId]);

  useEffect(() => {
    if (!discordEnabled) void clearDiscordPresence().catch(() => undefined);
  }, [discordEnabled]);
}
