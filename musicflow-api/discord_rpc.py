"""Discord Rich Presence — talks to the local Discord desktop client over its IPC pipe via
pypresence (a tiny, dependency-free wrapper around that protocol).

The Client ID below identifies the Musicflow *application* to Discord (it picks the name shown
on the presence card) — it is not tied to any one Discord account and isn't a secret. This is
how every app with Discord Rich Presence ships (Spotify, VS Code, OBS, ...): one ID baked into
the app, and it works immediately for any Discord user running it, with no per-user setup and
no cap on how many people can use it — SET_ACTIVITY (all Rich Presence is) never goes through
Discord's OAuth/approval-gated RPC surface (that gating — the "50 testers" / guild-count limits
— applies to privileged RPC commands like guild/channel management, not to setting an activity).

Entirely best-effort beyond that: Discord may not be installed or running, and neither should
ever break playback or the API request that triggered an update — every failure here is caught
and logged, never raised.
"""
import logging
import time

log = logging.getLogger("musicflow")

# Registered at discord.com/developers/applications — public identifier, safe to ship as-is.
CLIENT_ID = "1538934409896398948"

# Key of the Rich Presence art asset uploaded at discord.com/developers/applications/<id>/
# rich-presence/assets — not a file path, Discord serves the image from its own CDN once
# an asset with this exact key exists on the app.
LARGE_IMAGE_KEY = "logo"

try:
    from pypresence import ActivityType, Presence
except ImportError:
    Presence = None
    ActivityType = None

_rpc = None


def _ensure_connected() -> bool:
    global _rpc
    if Presence is None:
        return False
    if _rpc is not None:
        return True
    try:
        rpc = Presence(CLIENT_ID)
        rpc.connect()
        _rpc = rpc
        return True
    except Exception as e:
        log.info("[discord] connect failed (Discord not running?): %s", e)
        return False


def _close():
    global _rpc
    if _rpc is not None:
        try:
            _rpc.close()
        except Exception:
            pass
    _rpc = None


def update(title: str, artist: str, is_playing: bool, position: float, duration: float):
    if not _ensure_connected():
        return
    try:
        now = time.time()
        details = f"Listening to {title}"[:128] if title else "Musicflow"
        state = f"by {artist}" if artist else "Unknown artist"
        kwargs = {
            # Without this, Discord defaults to "Playing" — the game-controller icon and verb.
            # LISTENING gets Musicflow the same headphone-note icon/framing Spotify uses.
            "activity_type": ActivityType.LISTENING,
            "details": details,
            "state": state[:128],
            "large_image": LARGE_IMAGE_KEY,
            "large_text": "Musicflow",
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
