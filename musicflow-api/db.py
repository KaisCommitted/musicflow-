"""
SQLite database for Musicflow.
Stored at %APPDATA%/Musicflow/data.db — invisible to the user.
"""
import os
import sqlite3
import threading
from pathlib import Path

DB_DIR = os.path.join(os.environ.get("APPDATA", str(Path.home())), "Musicflow")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "data.db")

_local = threading.local()


def get_conn() -> sqlite3.Connection:
    """Thread-local connection (SQLite doesn't allow sharing across threads)."""
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS songs (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            duration REAL NOT NULL DEFAULT 0,
            track INTEGER,
            year INTEGER,
            has_artwork INTEGER NOT NULL DEFAULT 0,
            has_lyrics INTEGER NOT NULL DEFAULT 0,
            file_size INTEGER NOT NULL DEFAULT 0,
            last_modified REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playlists (
            name TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            playlist_name TEXT NOT NULL,
            song_path TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (playlist_name, song_path),
            FOREIGN KEY (playlist_name) REFERENCES playlists(name) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            started_at TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            done INTEGER NOT NULL DEFAULT 0,
            skipped INTEGER NOT NULL DEFAULT 0,
            errors INTEGER NOT NULL DEFAULT 0,
            cancelled INTEGER NOT NULL DEFAULT 0,
            query_text TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS history_items (
            history_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            query TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            link TEXT,
            error TEXT,
            PRIMARY KEY (history_id, idx),
            FOREIGN KEY (history_id) REFERENCES history(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lyrics_not_found (
            path TEXT NOT NULL,
            method TEXT NOT NULL,
            PRIMARY KEY (path, method)
        );

        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
        CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_path ON playlist_songs(song_path);
    """)
    conn.commit()


# ── Settings ──

def get_setting(key: str, default: str = "") -> str:
    row = get_conn().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    get_conn().execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
    )
    get_conn().commit()


def get_all_settings() -> dict:
    rows = get_conn().execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


# ── Song cache ──

def upsert_song(path: str, title: str, artist: str, album: str, duration: float,
                track: int | None, year: int | None, has_artwork: bool, has_lyrics: bool,
                file_size: int, last_modified: float):
    get_conn().execute("""
        INSERT OR REPLACE INTO songs (path, title, artist, album, duration, track, year,
                                      has_artwork, has_lyrics, file_size, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (path, title, artist, album, duration, track, year,
          int(has_artwork), int(has_lyrics), file_size, last_modified))
    get_conn().commit()


def get_cached_songs(folder: str) -> list[dict]:
    """Get all cached songs whose path starts with the given folder."""
    rows = get_conn().execute(
        "SELECT * FROM songs WHERE path LIKE ? || '%'", (folder.rstrip("/\\") + os.sep,)
    ).fetchall()
    return [dict(r) for r in rows]


def remove_stale_songs(folder: str, current_paths: set[str]):
    """Remove db entries for files that no longer exist on disk."""
    cached = get_conn().execute(
        "SELECT path FROM songs WHERE path LIKE ? || '%'", (folder.rstrip("/\\") + os.sep,)
    ).fetchall()
    stale = [r["path"] for r in cached if r["path"] not in current_paths]
    if stale:
        get_conn().executemany("DELETE FROM songs WHERE path = ?", [(p,) for p in stale])
        get_conn().commit()


# ── Lyrics scan memory ──
# A source that's been queried and came back with nothing is remembered here so the batch
# lyrics job never re-queries it — mirrors how a *found* source is remembered via its
# {basename}.{method}.lrc backup file on disk (see _seed_lyrics_sources in server.py).

def get_lyrics_not_found(paths: list[str]) -> dict[str, set[str]]:
    """Methods already confirmed to have no lyrics, keyed by song path."""
    if not paths:
        return {}
    placeholders = ",".join("?" * len(paths))
    rows = get_conn().execute(
        f"SELECT path, method FROM lyrics_not_found WHERE path IN ({placeholders})", paths
    ).fetchall()
    result: dict[str, set[str]] = {}
    for r in rows:
        result.setdefault(r["path"], set()).add(r["method"])
    return result


def mark_lyrics_not_found(path: str, method: str):
    get_conn().execute(
        "INSERT OR IGNORE INTO lyrics_not_found (path, method) VALUES (?, ?)", (path, method)
    )
    get_conn().commit()


# ── History ──

def save_history(job_id: str, started: str, total: int, done: int, skipped: int,
                 errors: int, cancelled: int, query_text: str, items: list[dict]):
    conn = get_conn()
    conn.execute("""
        INSERT OR REPLACE INTO history (id, started_at, total, done, skipped, errors, cancelled, query_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (job_id, started, total, done, skipped, errors, cancelled, query_text))
    conn.execute("DELETE FROM history_items WHERE history_id = ?", (job_id,))
    conn.executemany("""
        INSERT INTO history_items (history_id, idx, query, status, link, error)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [(job_id, i, it["query"], it["status"], it.get("link"), it.get("error"))
          for i, it in enumerate(items)])
    conn.commit()


def get_history_list(limit: int = 50) -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM history ORDER BY started_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_history_detail(job_id: str, page: int = 1, per_page: int = 20,
                       status_filter: str = "") -> dict | None:
    job = get_conn().execute("SELECT * FROM history WHERE id = ?", (job_id,)).fetchone()
    if not job:
        return None
    query = "SELECT * FROM history_items WHERE history_id = ?"
    params: list = [job_id]
    if status_filter:
        query += " AND status = ?"
        params.append(status_filter)
    query += " ORDER BY idx"
    all_items = get_conn().execute(query, params).fetchall()
    total_filtered = len(all_items)
    import math
    pages = math.ceil(total_filtered / per_page) if per_page else 1
    start = (page - 1) * per_page
    paged = all_items[start:start + per_page]
    return {
        "id": job["id"],
        "date": job["started_at"],
        "total": total_filtered,
        "done": job["done"],
        "errors": job["errors"],
        "items": [{"index": r["idx"], "query": r["query"], "status": r["status"],
                   "error": r["error"]} for r in paged],
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


# ── Playlists ──

def get_playlists() -> list[dict]:
    rows = get_conn().execute("SELECT name FROM playlists ORDER BY name").fetchall()
    result = []
    for r in rows:
        songs = get_conn().execute(
            "SELECT song_path FROM playlist_songs WHERE playlist_name = ? ORDER BY position",
            (r["name"],)
        ).fetchall()
        result.append({"name": r["name"], "songs": [s["song_path"] for s in songs]})
    return result


def create_playlist(name: str):
    get_conn().execute("INSERT OR IGNORE INTO playlists (name) VALUES (?)", (name,))
    get_conn().commit()


def delete_playlist(name: str):
    get_conn().execute("DELETE FROM playlists WHERE name = ?", (name,))
    get_conn().commit()


def update_playlist_songs(name: str, song_paths: list[str]):
    conn = get_conn()
    conn.execute("INSERT OR IGNORE INTO playlists (name) VALUES (?)", (name,))
    conn.execute("DELETE FROM playlist_songs WHERE playlist_name = ?", (name,))
    conn.executemany(
        "INSERT INTO playlist_songs (playlist_name, song_path, position) VALUES (?, ?, ?)",
        [(name, path, i) for i, path in enumerate(song_paths)]
    )
    conn.commit()


def playlists_for_song(song_path: str) -> list[str]:
    rows = get_conn().execute(
        "SELECT playlist_name FROM playlist_songs WHERE song_path = ?", (song_path,)
    ).fetchall()
    return [r["playlist_name"] for r in rows]


# Initialize on import
init_db()
