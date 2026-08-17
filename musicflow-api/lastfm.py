"""Last.fm scrobbling.

Unlike Discord (no account-linking at all) or ListenBrainz (a plain personal token, paste and
go), Last.fm's API requires two things:
  1. An API_KEY/API_SECRET identifying the *application* — like Discord's Client ID, this is
     baked in below once registered at last.fm/api/account/create, not something each user
     provides.
  2. A one-time browser authorization per Last.fm account, exchanged for a permanent session
     key — this part genuinely can't be skipped or baked in, Last.fm's API mandates it for
     any write access (scrobbling). See /api/lastfm/auth-start + /api/lastfm/auth-complete.

Uses urllib like the rest of this codebase's outbound HTTP — no new dependency.
Best-effort throughout: a network hiccup or revoked auth should never break playback.
"""
import hashlib
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("musicflow")

# Registered at last.fm/api/account/create — API_KEY is a public identifier (like Discord's
# Client ID); API_SECRET signs requests and is meant to stay out of a public repo in principle,
# but for a locally-run desktop app there's no server boundary to protect it behind — same
# trust model most open-source Last.fm scrobbler clients already ship under.
API_KEY = ""
API_SECRET = ""

API_ROOT = "https://ws.audioscrobbler.com/2.0/"
AUTH_ROOT = "https://www.last.fm/api/auth/"


def configured() -> bool:
    return bool(API_KEY and API_SECRET)


def _sign(params: dict) -> str:
    ordered = "".join(f"{k}{params[k]}" for k in sorted(params) if k != "format")
    return hashlib.md5((ordered + API_SECRET).encode("utf-8")).hexdigest()


def _call(method: str, params: dict, http_method: str = "GET") -> dict | None:
    if not configured():
        return None
    full = {**params, "method": method, "api_key": API_KEY}
    full["api_sig"] = _sign(full)
    full["format"] = "json"
    try:
        if http_method == "GET":
            url = f"{API_ROOT}?{urllib.parse.urlencode(full)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Musicflow/1.0"})
        else:
            body = urllib.parse.urlencode(full).encode()
            req = urllib.request.Request(
                API_ROOT, data=body, method="POST",
                headers={"User-Agent": "Musicflow/1.0",
                         "Content-Type": "application/x-www-form-urlencoded"},
            )
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log.info("[lastfm] %s failed: %s %s", method, e.code, e.read()[:200])
    except Exception as e:
        log.info("[lastfm] %s failed: %s", method, e)
    return None


def get_auth_token() -> str | None:
    r = _call("auth.getToken", {})
    return r.get("token") if r else None


def auth_url(token: str) -> str:
    return f"{AUTH_ROOT}?api_key={API_KEY}&token={token}"


def get_session(token: str) -> dict | None:
    """Exchanges a browser-authorized token for a permanent session. {"key": ..., "name": ...}"""
    r = _call("auth.getSession", {"token": token})
    return r.get("session") if r else None


def update_now_playing(session_key: str, artist: str, track: str, album: str, duration: float):
    if not session_key:
        return
    params = {"artist": artist or "Unknown artist", "track": track or "Unknown title", "sk": session_key}
    if album:
        params["album"] = album
    if duration > 0:
        params["duration"] = int(duration)
    _call("track.updateNowPlaying", params, http_method="POST")


def scrobble(session_key: str, artist: str, track: str, album: str, duration: float, timestamp: int):
    if not session_key:
        return
    params = {
        "artist": artist or "Unknown artist", "track": track or "Unknown title",
        "timestamp": timestamp, "sk": session_key,
    }
    if album:
        params["album"] = album
    if duration > 0:
        params["duration"] = int(duration)
    _call("track.scrobble", params, http_method="POST")
