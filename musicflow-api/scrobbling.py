"""ListenBrainz scrobbling — a plain HTTPS POST carrying the user's personal token, no OAuth
handshake (unlike Last.fm, which needs a registered API key/secret plus a browser-based auth
flow to get a session key — meaningfully more setup for the same result, so left out for now).
Uses urllib like the rest of this codebase's outbound HTTP — no new dependency.

Best-effort throughout: a network hiccup or a bad token should never break playback.
"""
import json
import logging
import time
import urllib.error
import urllib.request

log = logging.getLogger("musicflow")

SUBMIT_URL = "https://api.listenbrainz.org/1/submit-listens"


def _track_metadata(title: str, artist: str, album: str, duration: float) -> dict:
    meta = {"artist_name": artist or "Unknown artist", "track_name": title or "Unknown title"}
    if album:
        meta["release_name"] = album
    if duration > 0:
        meta["additional_info"] = {"duration_ms": int(duration * 1000)}
    return meta


def _submit(token: str, listen_type: str, payload: list[dict]):
    body = json.dumps({"listen_type": listen_type, "payload": payload}).encode()
    req = urllib.request.Request(
        SUBMIT_URL, data=body, method="POST",
        headers={
            "Authorization": f"Token {token}",
            "Content-Type": "application/json",
            "User-Agent": "Musicflow/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        log.info("[listenbrainz] %s failed: %s %s", listen_type, e.code, e.read()[:200])
    except Exception as e:
        log.info("[listenbrainz] %s failed: %s", listen_type, e)


def now_playing(token: str, title: str, artist: str, album: str, duration: float):
    _submit(token, "playing_now", [
        {"track_metadata": _track_metadata(title, artist, album, duration)},
    ])


def submit_listen(token: str, title: str, artist: str, album: str, duration: float):
    _submit(token, "single", [{
        "listened_at": int(time.time()),
        "track_metadata": _track_metadata(title, artist, album, duration),
    }])
