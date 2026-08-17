import { usePlayer } from "@/store/player";
import { useLibrary } from "@/store/library";
import {
  reportLastfmNowPlaying,
  reportNowPlaying,
  submitLastfmScrobble,
  submitScrobble,
} from "@/lib/api";

// Deliberately a plain store subscription, not a React hook — playback position updates
// several times a second, and checking "has this song crossed the scrobble threshold yet"
// needs to see every one of those ticks. Doing that via a React-subscribed `currentTime`
// would re-render whatever component owns the hook on every tick just to run a comparison
// that almost always no-ops; subscribing directly to the store sidesteps React entirely.
let initialized = false;
let lastSongId: string | null = null;
let nowPlayingReported = false;
let scrobbled = false;

/** Standard scrobble rule (Last.fm/ListenBrainz convention): a listen counts once played for
 * at least half the track or 4 minutes, whichever is shorter, and the track is over 30s. */
function scrobbleThreshold(duration: number): number | null {
  if (duration <= 30) return null;
  return Math.min(duration * 0.5, 240);
}

export function initScrobbling() {
  if (initialized) return;
  initialized = true;

  usePlayer.subscribe((state) => {
    const settings = useLibrary.getState().settings;
    const lbOn = settings.scrobblingEnabled && !!settings.listenbrainzToken;
    const lfOn = settings.lastfmEnabled;
    if (!lbOn && !lfOn) return;

    const song = state.current();
    const songId = song?.id ?? null;
    if (songId !== lastSongId) {
      lastSongId = songId;
      nowPlayingReported = false;
      scrobbled = false;
    }
    if (!song) return;

    const duration = state.duration || song.duration || 0;
    const payload = { title: song.title, artist: song.artist, album: song.album, duration };

    if (state.isPlaying && !nowPlayingReported) {
      nowPlayingReported = true;
      if (lbOn) void reportNowPlaying(payload).catch(() => undefined);
      if (lfOn) void reportLastfmNowPlaying(payload).catch(() => undefined);
    }

    if (!scrobbled) {
      const threshold = scrobbleThreshold(duration);
      if (threshold != null && state.currentTime >= threshold) {
        scrobbled = true;
        if (lbOn) void submitScrobble(payload).catch(() => undefined);
        if (lfOn) void submitLastfmScrobble(payload).catch(() => undefined);
      }
    }
  });
}
