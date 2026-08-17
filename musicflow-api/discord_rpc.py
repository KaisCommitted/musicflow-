"""Discord Rich Presence — talks to the local Discord desktop client over its IPC pipe via
pypresence (a tiny, dependency-free wrapper around that protocol).

Entirely best-effort: Discord may not be installed, not running, or no client ID configured
yet — none of that should ever break playback or the API request that triggered an update, so
every failure here is caught and logged, never raised.
"""
import logging
import time

log = logging.getLogger("musicflow")

try:
    from pypresence import Presence
except ImportError:
    Presence = None

_rpc = None
_client_id: str | None = None


def _ensure_connected(client_id: str) -> bool:
    global _rpc, _client_id
    if Presence is None:
        return False
    if _rpc is not None and _client_id == client_id:
        return True
    _close()
    try:
        rpc = Presence(client_id)
        rpc.connect()
        _rpc = rpc
        _client_id = client_id
        return True
    except Exception as e:
        log.info("[discord] connect failed (Discord not running?): %s", e)
        return False


def _close():
    global _rpc, _client_id
    if _rpc is not None:
        try:
            _rpc.close()
        except Exception:
            pass
    _rpc = None
    _client_id = None


def update(client_id: str, title: str, artist: str, is_playing: bool,
           position: float, duration: float):
    if not client_id or not _ensure_connected(client_id):
        return
    try:
        now = time.time()
        kwargs = {
            "details": (title or "Musicflow")[:128],
            "state": (artist or "Unknown artist")[:128],
        }
        if is_playing:
            kwargs["start"] = int(now - position)
            if duration > 0:
                kwargs["end"] = int(now - position + duration)
        _rpc.update(**kwargs)
    except Exception as e:
        log.info("[discord] update failed: %s", e)
        # The IPC pipe can go stale (Discord restarted, etc.) — drop the connection so the
        # next update() call reconnects from scratch instead of repeating the same failure.
        _close()


def clear():
    if _rpc is not None:
        try:
            _rpc.clear()
        except Exception:
            pass
