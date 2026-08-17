"""Entry point for the PyInstaller-frozen backend used by the Electron shell.

Unlike the old pywebview-based app.py, this owns no window — Electron creates the
BrowserWindow and manages this process's lifecycle; all this does is serve the Flask app on
a port Electron picked (so it never collides with a `py server.py` dev instance someone
already has running) and log to a file Electron can surface if startup fails.
"""
import logging
import os
import sys

from server import app, db

log = logging.getLogger("musicflow")


def _log_path() -> str:
    # Same convention db.py already uses for the sqlite file — keeps everything Musicflow
    # writes under one folder, easy to find for support/debugging.
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    log_dir = os.path.join(base, "Musicflow")
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "backend.log")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(message)s",
        datefmt="%H:%M:%S",
        # Electron captures stdout/stderr for its own log too — writing to a file as well
        # means the backend's own log survives even if Electron's capture doesn't, and is
        # findable without digging through Electron's log.
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(_log_path(), encoding="utf-8")],
    )

    port = int(os.environ.get("MUSICFLOW_PORT", "5000"))
    log.info("[electron] Starting on 127.0.0.1:%d (db: %s)", port, db.DB_PATH)
    # threaded=True: audio streaming holds a request open for as long as a song plays, which
    # would otherwise block every other endpoint (scan, download, ...) behind it.
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
