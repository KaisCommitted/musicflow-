"""Spotify playlist import — reads a public playlist's track list with no login or API
credentials, by parsing the __NEXT_DATA__ JSON that Spotify's own site embeds into its
public embed page (open.spotify.com/embed/playlist/<id>) to render it. That's the same
data the embed widget itself uses, not a private endpoint — but it's unofficial and
undocumented, so Spotify could change the page's markup at any time.

The official Web API (Client Credentials flow) was tried first and the app credentials
work fine, but Spotify now requires the app-owning account to have an active Premium
subscription just to call it (403 "Active premium subscription required for the owner
of the app") — confirmed against this app's real credentials. Kais's account is free,
so that path is dead until/unless that changes; this scrape is the working fallback.

Known limitation, confirmed empirically against two 150+ track playlists: the embed
page only ever returns a playlist's first 100 tracks. Longer playlists come back
truncated — callers get a `truncated` flag so the UI can say so instead of pretending
the whole playlist downloaded.
"""
import json
import logging
import re
import ssl
import urllib.error
import urllib.request

import certifi

log = logging.getLogger("musicflow")

EMBED_URL = "https://open.spotify.com/embed/playlist/{id}"
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# open.spotify.com's cert chain doesn't verify against every Windows Python install's
# default trust store (confirmed: it fails here while api.spotify.com's chain doesn't) —
# certifi's bundle is what yt-dlp already relies on transitively, made explicit here
# rather than hoping it stays available as someone else's dependency.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

PLAYLIST_ID_RE = re.compile(r"playlist[/:]([A-Za-z0-9]+)")
BARE_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")

TRACK_CAP = 100


def extract_playlist_id(text: str) -> str | None:
    """Pulls a playlist ID out of a full share URL (open.spotify.com/playlist/ID,
    intl-xx locale prefix, or spotify:playlist:ID), or accepts a bare ID pasted directly."""
    text = text.strip()
    m = PLAYLIST_ID_RE.search(text)
    if m:
        return m.group(1)
    return text if BARE_ID_RE.match(text) else None


def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict], bool]:
    """Returns (playlist_name, [{"artist": ..., "title": ...}, ...], truncated).
    `truncated` is True when the playlist likely has more tracks than were returned
    (the embed page caps at 100). Raises RuntimeError with a user-facing message on
    failure."""
    req = urllib.request.Request(
        EMBED_URL.format(id=playlist_id), headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CONTEXT) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError("Playlist not found — it may be private or the link is wrong")
        raise RuntimeError(f"Spotify request failed ({e.code})")
    except Exception as e:
        log.warning("[spotify] Fetch failed for %s: %s", playlist_id, e)
        raise RuntimeError("Couldn't reach Spotify")

    m = NEXT_DATA_RE.search(html)
    if not m:
        raise RuntimeError("Playlist not found — it may be private or the link is wrong")

    try:
        data = json.loads(m.group(1))
        entity = data["props"]["pageProps"]["state"]["data"]["entity"]
    except (KeyError, json.JSONDecodeError) as e:
        log.warning("[spotify] Unexpected embed page shape for %s: %s", playlist_id, e)
        raise RuntimeError("Couldn't read that playlist (Spotify may have changed its page)")

    if entity.get("type") != "playlist":
        raise RuntimeError("That link isn't a playlist")

    name = entity.get("name") or "Spotify Playlist"
    raw_tracks = entity.get("trackList", [])
    tracks = [
        {"artist": t.get("subtitle") or "", "title": t["title"]}
        for t in raw_tracks
        if t.get("title")
    ]
    return name, tracks, len(raw_tracks) >= TRACK_CAP
