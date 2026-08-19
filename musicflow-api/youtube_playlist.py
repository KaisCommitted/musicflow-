"""YouTube playlist import — expands a public YouTube playlist link into per-track search
queries using the same flat-extraction yt-dlp already relies on elsewhere in this app. No
YouTube Data API key involved: `extract_flat` + `skip_download` is the same metadata listing
a plain `yt-dlp <playlist-url>` reads on its own, just without downloading anything.

Each entry's video title is run through main.parse_artist_title (the same "Artist - Title"
guess used for a plain search result) to build a query — the query is then re-searched
through the normal /api/start pipeline like any hand-typed song, so it still gets the usual
metadata/artwork/lyrics matching rather than just trusting the playlist's own video.

Playlists can run into the thousands of videos — capped at TRACK_CAP so a single pasted link
can't silently queue an unbounded download job. Callers get a `truncated` flag when the real
playlist has more tracks than were returned, same shape as the Spotify import.
"""
import logging
import re
from urllib.parse import parse_qs, urlparse

import yt_dlp

from main import parse_artist_title

log = logging.getLogger("musicflow")

PLAYLIST_URL = "https://www.youtube.com/playlist?list={id}"
BARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")

TRACK_CAP = 300

_UNAVAILABLE_TITLES = {"[Private video]", "[Deleted video]"}


def extract_playlist_id(text: str) -> str | None:
    """Pulls a playlist ID out of a full YouTube URL (?list=..., watch?v=...&list=...,
    youtu.be/...?list=...), or accepts a bare playlist ID pasted directly."""
    text = text.strip()
    parsed = urlparse(text)
    if parsed.netloc and "youtu" in parsed.netloc:
        list_id = parse_qs(parsed.query).get("list", [None])[0]
        return list_id
    return text if BARE_ID_RE.match(text) else None


def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict], bool]:
    """Returns (playlist_name, [{"artist": ..., "title": ...}, ...], truncated).
    `truncated` is True when the playlist has more videos than TRACK_CAP. Raises
    RuntimeError with a user-facing message on failure."""
    ydl_opts = {
        "extract_flat": True,
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "playlistend": TRACK_CAP,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(PLAYLIST_URL.format(id=playlist_id), download=False)
    except Exception as e:
        log.warning("[youtube-playlist] Fetch failed for %s: %s", playlist_id, e)
        raise RuntimeError("Couldn't read that playlist — it may be private or the link is wrong")

    if not info or info.get("_type") != "playlist":
        raise RuntimeError("That link isn't a playlist")

    entries = [
        e for e in (info.get("entries") or [])
        if e and e.get("title") and e.get("title") not in _UNAVAILABLE_TITLES
    ]
    if not entries:
        raise RuntimeError("That playlist has no videos")

    name = info.get("title") or "YouTube Playlist"
    tracks = []
    for entry in entries:
        artist, title = parse_artist_title(entry["title"])
        tracks.append({"artist": artist or "", "title": title})

    total = info.get("playlist_count") or len(entries)
    truncated = total > TRACK_CAP
    return name, tracks, truncated
