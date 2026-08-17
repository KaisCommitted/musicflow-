import io
import json
import logging
import os
import random
import re
import time
import urllib.parse
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache

from flask import Flask, jsonify, request, send_file, Response
from mutagen.id3 import ID3, ID3NoHeaderError, USLT
from mutagen.mp3 import MP3
from PIL import Image
from main import find_ffmpeg, get_first_video_link, parse_artist_title, fetch_lyrics, fetch_lyrics_from_source, LYRICS_SOURCE_ORDER, fetch_music_metadata, apply_metadata, generate_playlist, parse_playlist_input, rename_lyrics_backups
import db
import discord_rpc
import scrobbling
import lastfm

import yt_dlp

# ── Logging setup ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("musicflow")
# Quiet down Flask/werkzeug request spam
logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__, static_folder="static")

jobs: dict[str, dict] = {}


def music_folder() -> str | None:
    """The user-configured music folder (same folder library scans and downloads both use).
    Returns None if it's never been set or no longer exists on disk."""
    folder = db.get_setting("musicFolder", "").strip()
    if not folder or not os.path.isdir(folder):
        return None
    return folder


class JobInterrupted(Exception):
    """Raised from the progress hook to abort an in-flight yt-dlp download when stopped."""
    pass


def sanitize_filename(text: str) -> str:
    safe = "".join(c if c.isalnum() or c in " -_(),'&!." else "" for c in text).strip()
    safe = re.sub(r'[\s_]*mp3$', '', safe, flags=re.IGNORECASE).strip()
    return safe


class ProgressHook:
    def __init__(self, item: dict, job: dict):
        self.item = item
        self.job = job

    def __call__(self, d: dict):
        if self.job.get("cancelled"):
            raise JobInterrupted()
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            if total > 0:
                self.item["progress"] = round(downloaded / total * 100, 1)
        elif d["status"] == "finished":
            self.item["progress"] = 100


def process_query(item: dict, ffmpeg_path: str | None, existing_files: set[str], job: dict, folder: str, files_lock: threading.Lock = None):
    query = item["query"]

    # Step 1: Search
    item["status"] = "searching"
    log.info("[download] Searching: %s", query)
    try:
        result = get_first_video_link(query)
    except Exception as e:
        item["status"] = "error"
        item["error"] = f"Search failed: {e}"
        log.error("[download] Search failed for '%s': %s", query, e)
        return

    if not result:
        item["status"] = "error"
        item["error"] = "No results found"
        log.warning("[download] No results for: %s", query)
        return

    link, video_title, thumbnail_url = result
    item["link"] = link
    log.info("[download] Found: %s → %s", query, video_title)

    # Step 2: Determine filename from the actual video title (corrected later with metadata)
    artist_guess, title_guess = parse_artist_title(video_title)
    base_name = f"{artist_guess} - {title_guess}" if artist_guess else title_guess
    safe_name = sanitize_filename(base_name)
    mp3_path = os.path.join(folder, f"{safe_name}.mp3")

    if files_lock:
        files_lock.acquire()
    skip = f"{safe_name}.mp3".lower() in existing_files
    if files_lock:
        files_lock.release()

    if skip:
        item["status"] = "skipped"
        item["file"] = mp3_path
        item["progress"] = 100

        # Verify filename matches metadata — rename if needed
        try:
            metadata = fetch_music_metadata(artist_guess, title_guess, query)
            if metadata and metadata.get("artist") and metadata.get("title"):
                final_name = sanitize_filename(f"{metadata['artist']} - {metadata['title']}")
                final_path = os.path.join(folder, f"{final_name}.mp3")
                if final_name and final_name.lower() != safe_name.lower() and not os.path.exists(final_path):
                    try:
                        os.rename(mp3_path, final_path)
                        old_lrc = mp3_path.rsplit(".", 1)[0] + ".lrc"
                        if os.path.exists(old_lrc):
                            os.rename(old_lrc, final_path.rsplit(".", 1)[0] + ".lrc")
                        rename_lyrics_backups(mp3_path, final_path)
                        item["file"] = final_path
                        log.info("[download] Skipped & renamed: %s → %s", safe_name, final_name)
                        if files_lock:
                            with files_lock:
                                existing_files.discard(f"{safe_name}.mp3".lower())
                                existing_files.add(f"{final_name}.mp3".lower())
                        else:
                            existing_files.discard(f"{safe_name}.mp3".lower())
                            existing_files.add(f"{final_name}.mp3".lower())
                    except Exception:
                        pass
                else:
                    log.info("[download] Skipped (exists): %s", safe_name)
            else:
                log.info("[download] Skipped (exists): %s", safe_name)
        except Exception:
            log.info("[download] Skipped (exists): %s", safe_name)
        return

    item["status"] = "downloading"
    log.info("[download] Downloading: %s", safe_name)
    hook = ProgressHook(item, job)

    if job.get("cancelled"):
        item["status"] = "cancelled"
        item["error"] = "Cancelled"
        cleanup_partial_files(folder, safe_name)
        return

    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            },
        ],
        "outtmpl": os.path.join(folder, f"{safe_name}.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [hook],
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
        "retries": 3,
        "fragment_retries": 3,
        "extractor_retries": 3,
        "sleep_interval": 1,
        "max_sleep_interval": 3,
    }
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([link])

        if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
            item["file"] = mp3_path
            item["progress"] = 100
            if files_lock:
                with files_lock:
                    existing_files.add(f"{safe_name}.mp3".lower())
            else:
                existing_files.add(f"{safe_name}.mp3".lower())

            # Fetch metadata + lyrics — failures here should not retry the download
            metadata = {}
            try:
                log.info("[download] Fetching metadata & lyrics for: %s", safe_name)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    meta_future = pool.submit(fetch_music_metadata, artist_guess, title_guess, query)
                    lyric_future = pool.submit(fetch_lyrics, artist_guess, title_guess, query, mp3_path)
                    metadata = meta_future.result() or {}
                    lyrics = lyric_future.result()
                if not metadata.get("artwork_url") and thumbnail_url:
                    metadata["artwork_url"] = thumbnail_url
                apply_metadata(mp3_path, metadata, lyrics)
            except Exception as meta_err:
                log.warning("[download] Metadata/lyrics failed for %s: %s", safe_name, meta_err)

            # Correct the filename using accurate metadata, if found and different
            if metadata and metadata.get("artist") and metadata.get("title"):
                final_name = sanitize_filename(f"{metadata['artist']} - {metadata['title']}")
                final_path = os.path.join(folder, f"{final_name}.mp3")
                if final_name and final_name.lower() != safe_name.lower() and not os.path.exists(final_path):
                    try:
                        os.rename(mp3_path, final_path)
                        old_lrc = mp3_path.rsplit(".", 1)[0] + ".lrc"
                        if os.path.exists(old_lrc):
                            os.rename(old_lrc, final_path.rsplit(".", 1)[0] + ".lrc")
                        rename_lyrics_backups(mp3_path, final_path)
                        item["file"] = final_path
                        log.info("[download] Renamed: %s → %s", safe_name, final_name)
                        if files_lock:
                            with files_lock:
                                existing_files.discard(f"{safe_name}.mp3".lower())
                                existing_files.add(f"{final_name}.mp3".lower())
                        else:
                            existing_files.discard(f"{safe_name}.mp3".lower())
                            existing_files.add(f"{final_name}.mp3".lower())
                    except Exception:
                        pass

            # Mark done only after metadata+artwork is written
            item["status"] = "done"
            item["completed_at"] = time.time()
            log.info("[download] ✓ Complete: %s", os.path.basename(item["file"]))
            return

        raise RuntimeError("Downloaded file is empty or missing")

    except Exception as exc:
        cleanup_partial_files(folder, safe_name)

        if job.get("cancelled"):
            item["status"] = "cancelled"
            item["error"] = "Cancelled"
            return

        item["status"] = "error"
        item["error"] = re.sub(r'\x1b\[[0-9;]*m', '', str(exc))
        log.warning("[download] ✗ Failed: %s (%s)", query, exc)
        item["progress"] = 0


def cleanup_partial_files(directory: str, safe_name: str):
    """Remove any partial/corrupted files left by a failed download."""
    for ext in (".mp3", ".webm", ".m4a", ".opus", ".part", ".ytdl", ".temp"):
        path = os.path.join(directory, f"{safe_name}{ext}")
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
    # Also clean .part variants (yt-dlp appends .part to in-progress downloads)
    for f in os.listdir(directory):
        if f.startswith(safe_name) and f.endswith(".part"):
            try:
                os.remove(os.path.join(directory, f))
            except Exception:
                pass


IN_DOCKER = os.path.exists("/.dockerenv")


# ── Prevent Windows sleep during long jobs ──
def _prevent_sleep():
    """Tell Windows to keep the system awake (no sleep/display off)."""
    if IN_DOCKER:
        return
    try:
        import ctypes
        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    except Exception:
        pass


def _allow_sleep():
    """Restore normal Windows sleep behavior."""
    if IN_DOCKER:
        return
    try:
        import ctypes
        ES_CONTINUOUS = 0x80000000
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
    except Exception:
        pass


MAX_WORKERS = 3
MAX_RETRY_CYCLES = 10


def process_job(job_id: str):
    job = jobs[job_id]
    folder = job["folder"]
    ffmpeg_path = find_ffmpeg()
    log.info("[job %s] Starting download job (%d songs)", job_id, len(job["items"]))
    _prevent_sleep()
    existing_files = {f.lower() for f in os.listdir(folder) if f.lower().endswith(".mp3")}
    files_lock = threading.Lock()
    done_counter = {"count": 0}
    # Global throttle: at most one download starts every 2.5s
    throttle_lock = threading.Lock()
    last_start = {"t": 0.0}

    def throttle():
        with throttle_lock:
            elapsed = time.time() - last_start["t"]
            if elapsed < 2.5:
                time.sleep(2.5 - elapsed)
            last_start["t"] = time.time()

    def worker(item):
        while job.get("paused") and not job.get("cancelled"):
            time.sleep(0.5)
        if job.get("cancelled"):
            item["status"] = "cancelled"
            item["error"] = "Cancelled"
            return
        throttle()
        process_query(item, ffmpeg_path, existing_files, job, folder, files_lock)
        if item["status"] in ("done", "skipped"):
            with files_lock:
                done_counter["count"] += 1
            # Silent rate-limit pause outside the lock
            if done_counter["count"] % 10 == 0 and not job.get("cancelled"):
                time.sleep(10)

    # Max time for retries: 10s per song
    max_duration = 10 * len(job["items"])
    job_start_time = time.time()

    for cycle in range(MAX_RETRY_CYCLES):
        if job.get("cancelled"):
            break

        # Timeout check
        if time.time() - job_start_time > max_duration:
            log.info("[job %s] Timeout reached (%ds), stopping retries", job_id, max_duration)
            break

        # Gather items that need processing this cycle
        to_process = [i for i in job["items"] if i["status"] in ("pending", "error")]
        if not to_process:
            break

        if cycle > 0:
            log.info("[job %s] Retry cycle %d — %d songs remaining", job_id, cycle, len(to_process))
            for item in to_process:
                item["status"] = "pending"
                item["error"] = None
                item["progress"] = 0
            time.sleep(5 + random.uniform(1, 5))

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = []
            for item in to_process:
                if job.get("cancelled"):
                    break
                futures.append(pool.submit(worker, item))
            for f in futures:
                f.result()

        # Check if all done
        errors_left = sum(1 for i in job["items"] if i["status"] == "error")
        if errors_left == 0:
            break

    # Mark any remaining pending items as cancelled
    for item in job["items"]:
        if item["status"] == "pending":
            item["status"] = "cancelled"
            item["error"] = "Cancelled"

    # Clean up partial files for cancelled/errored items
    if job.get("cancelled"):
        for item in job["items"]:
            if item["status"] == "cancelled" and not item.get("file"):
                query = item["query"]
                artist_guess, title_guess = parse_artist_title(query)
                base_name = f"{artist_guess} - {title_guess}" if artist_guess else title_guess
                safe_name = sanitize_filename(base_name)
                cleanup_partial_files(folder, safe_name)

    # Update history with final results
    job["finished"] = True
    save_job_to_history(job_id)
    done = sum(1 for i in job["items"] if i["status"] == "done")
    errs = sum(1 for i in job["items"] if i["status"] in ("error", "cancelled"))
    log.info("[job %s] Finished — %d done, %d errors/cancelled", job_id, done, errs)
    _allow_sleep()


@app.after_request
def add_no_cache_headers(response):
    # Artwork sets its own long-lived Cache-Control (it's the one API response that's actually
    # safe, and valuable, to cache — see get_cover/get_artwork) and would otherwise get
    # clobbered back to no-store by this blanket rule on every other /api/ response.
    is_artwork = request.path.startswith("/api/cover") or request.path.startswith("/api/artwork/")
    if not request.path.startswith("/assets/") and not is_artwork:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.route("/")
def index():
    return send_file("static/index.html")


@app.route("/<path:path>")
def catch_all(path):
    # Serve static assets if they exist, otherwise return index.html for client-side routing
    static_path = os.path.join(app.static_folder, path)
    if os.path.isfile(static_path):
        return send_file(static_path)
    return send_file("static/index.html")


@app.route("/api/start", methods=["POST"])
def start_job():
    data = request.get_json()
    raw_queries = [q.strip() for q in data.get("queries", []) if q.strip()]

    # Deduplicate identical queries so the same song isn't queued twice
    seen = set()
    queries = []
    for q in raw_queries:
        if q not in seen:
            queries.append(q)
            seen.add(q)

    if not queries:
        return jsonify({"error": "No queries provided"}), 400

    folder = music_folder()
    if not folder:
        return jsonify({"error": "No music folder configured"}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "queries": queries,
        "folder": folder,
        "started": datetime.now().isoformat(),
        "cancelled": False,
        "paused": False,
        "items": [
            {"query": q, "status": "pending", "link": None, "file": None, "progress": 0, "error": None}
            for q in queries
        ],
    }

    # Save history immediately so it appears in the history tab right away
    save_job_to_history(job_id)

    thread = threading.Thread(target=process_job, args=(job_id,), daemon=True)
    thread.start()

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    items = job["items"]
    total = len(items)
    done = sum(1 for i in items if i["status"] == "done")
    skipped = sum(1 for i in items if i["status"] == "skipped")
    errors = sum(1 for i in items if i["status"] == "error")
    cancelled = sum(1 for i in items if i["status"] == "cancelled")
    active = sum(1 for i in items if i["status"] in ("searching", "downloading"))
    pending = sum(1 for i in items if i["status"] == "pending")
    paused = job.get("paused", False)
    finished = job.get("finished", False)
    # Include original index for audio/artwork URLs, plus the final saved filename for display
    indexed = []
    for idx, i in enumerate(items):
        if i["status"] in ("pending", "searching"):
            continue
        if i["status"] in ("error", "cancelled") and not finished:
            continue
        if i["status"] == "downloading" and (i.get("progress") or 0) < 1:
            continue
        # Always show completed items regardless of progress history
        # (they may have had progress reset during retry cycles)
        display_name = os.path.splitext(os.path.basename(i["file"]))[0] if i.get("file") else None
        # Parse "Artist - Title" from display_name for the frontend
        title = display_name or i["query"]
        artist = ""
        if display_name and " - " in display_name:
            parts = display_name.split(" - ", 1)
            artist = parts[0]
            title = parts[1]
        indexed.append({
            "index": idx,
            "query": i["query"],
            "title": title,
            "artist": artist,
            "status": i["status"],
            "progress": (i.get("progress") or 0) / 100,
            "error": i.get("error") if i["status"] in ("error", "cancelled") else None,
            "link": i.get("link"),
            "_completed_at": i.get("completed_at", 0),
        })
    # Sort: active downloads first, then completed by most recent
    def sort_key(x):
        if x["status"] == "downloading":
            return (0, 0)
        return (1, -(x.get("_completed_at") or 0))
    indexed.sort(key=sort_key)
    # Remove internal field before sending
    for item in indexed:
        item.pop("_completed_at", None)
    recent = indexed
    return jsonify({
        "total": total, "done": done, "skipped": skipped,
        "errors": errors if finished else 0,
        "cancelled": cancelled, "active": active, "pending": pending,
        "finished": finished, "paused": paused, "recent": recent,
    })


@app.route("/api/stop/<job_id>", methods=["POST"])
def stop_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    job["cancelled"] = True
    job["paused"] = False
    return jsonify({"ok": True})


@app.route("/api/pause/<job_id>", methods=["POST"])
def pause_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    job["paused"] = True
    return jsonify({"ok": True})


@app.route("/api/resume/<job_id>", methods=["POST"])
def resume_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    job["paused"] = False
    return jsonify({"ok": True})


@app.route("/api/retry/<job_id>", methods=["POST"])
def retry_failed(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    for item in job["items"]:
        if item["status"] in ("error", "cancelled"):
            item["status"] = "pending"
            item["error"] = None
            item["progress"] = 0
    job["cancelled"] = False
    job["paused"] = False
    job["finished"] = False
    thread = threading.Thread(target=process_job, args=(job_id,), daemon=True)
    thread.start()
    return jsonify({"ok": True})


@app.route("/api/download/<job_id>/<int:index>")
def download_file(job_id: str, index: int):
    job = jobs.get(job_id)
    if not job or index >= len(job["items"]):
        return jsonify({"error": "Not found"}), 404

    item = job["items"][index]
    if item["status"] != "done" or not item["file"]:
        return jsonify({"error": "File not ready"}), 400

    return send_file(item["file"], as_attachment=True)


@app.route("/api/stream/<job_id>/<int:index>")
def stream_file(job_id: str, index: int):
    job = jobs.get(job_id)
    if not job or index >= len(job["items"]):
        return jsonify({"error": "Not found"}), 404

    item = job["items"][index]
    if item["status"] not in ("done", "skipped") or not item["file"]:
        return jsonify({"error": "File not ready"}), 400

    return send_file(item["file"], mimetype="audio/mpeg", conditional=True)


@app.route("/api/lyrics/<job_id>/<int:index>")
def get_lyrics(job_id: str, index: int):
    job = jobs.get(job_id)
    if not job or index >= len(job["items"]):
        return jsonify({"error": "Not found"}), 404

    item = job["items"][index]
    if item["status"] not in ("done", "skipped") or not item["file"]:
        return jsonify({"error": "Not found"}), 404

    try:
        tags = ID3(item["file"])
        uslts = tags.getall("USLT")
        if uslts:
            return jsonify({"lyrics": uslts[0].text})
    except Exception:
        pass
    return jsonify({"lyrics": None})


@app.route("/api/artwork/<job_id>/<int:index>")
def get_artwork(job_id: str, index: int):
    job = jobs.get(job_id)
    if not job or index >= len(job["items"]):
        return jsonify({"error": "Not found"}), 404

    item = job["items"][index]
    if item["status"] not in ("done", "skipped") or not item["file"]:
        return jsonify({"error": "Not found"}), 404

    size = request.args.get("size", type=int)
    try:
        if size:
            size = max(16, min(size, 1024))
            data = _resized_cover_bytes(item["file"], os.path.getmtime(item["file"]), size)
            if data is None:
                return jsonify({"error": "No artwork"}), 404
            resp = Response(data, mimetype="image/jpeg")
        else:
            raw = _raw_cover(item["file"])
            if raw is None:
                return jsonify({"error": "No artwork"}), 404
            resp = Response(raw[0], mimetype=raw[1])
        resp.headers["Cache-Control"] = "public, max-age=604800"
        return resp
    except Exception:
        return jsonify({"error": "No artwork"}), 404


def save_job_to_history(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return
    items = job["items"]
    db.save_history(
        job_id=job_id,
        started=job.get("started", ""),
        total=len(items),
        done=sum(1 for i in items if i["status"] == "done"),
        skipped=sum(1 for i in items if i["status"] == "skipped"),
        errors=sum(1 for i in items if i["status"] == "error"),
        cancelled=sum(1 for i in items if i["status"] == "cancelled"),
        query_text="\n".join(job["queries"]),
        items=[{"query": i["query"], "status": i["status"], "link": i.get("link"), "error": i.get("error")} for i in items],
    )


@app.route("/api/history")
def get_history():
    jobs_list = db.get_history_list()
    summary = [{"id": j["id"], "date": j["started_at"], "total": j["total"],
                "done": j["done"], "skipped": j["skipped"],
                "errors": j["errors"], "cancelled": j["cancelled"]}
               for j in jobs_list]
    return jsonify({"jobs": summary})


@app.route("/api/history/<history_id>")
def get_history_detail(history_id: str):
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))
    status_filter = request.args.get("status", "")
    result = db.get_history_detail(history_id, page, per_page, status_filter)
    if not result:
        return jsonify({"error": "Not found"}), 404
    return jsonify(result)


@app.route("/api/history/retry", methods=["POST"])
def retry_history_item():
    """Retry a single failed item from a history record."""
    data = request.get_json()
    history_id = data.get("history_id", "")
    query = data.get("query", "").strip()
    if not history_id or not query:
        return jsonify({"error": "Missing history_id or query"}), 400

    # If this job is still in memory, retry from there
    job = jobs.get(history_id)
    if job:
        for item in job["items"]:
            if item["query"] == query and item["status"] in ("error", "cancelled"):
                item["status"] = "pending"
                item["error"] = None
                item["progress"] = 0
                job["cancelled"] = False
                thread = threading.Thread(target=process_job, args=(history_id,), daemon=True)
                thread.start()
                return jsonify({"ok": True, "job_id": history_id})

    # Otherwise, create a new single-item job for this query
    folder = music_folder()
    if not folder:
        return jsonify({"error": "No music folder configured"}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "queries": [query],
        "folder": folder,
        "started": datetime.now().isoformat(),
        "cancelled": False,
        "paused": False,
        "items": [{"query": query, "status": "pending", "link": None, "file": None, "progress": 0, "error": None}],
    }
    save_job_to_history(job_id)
    thread = threading.Thread(target=process_job, args=(job_id,), daemon=True)
    thread.start()

    return jsonify({"ok": True, "job_id": job_id})


lyrics_jobs: dict[str, dict] = {}


@app.route("/api/generate-lyrics", methods=["POST"])
def generate_lyrics():
    """Scan a folder of MP3s and fetch/replace lyrics for all of them."""
    data = request.get_json()
    folder = data.get("folder", "").strip()
    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder path"}), 400

    mp3s = sorted(f for f in os.listdir(folder) if f.lower().endswith(".mp3"))
    if not mp3s:
        return jsonify({"error": "No MP3 files found in folder"}), 400

    job_id = str(uuid.uuid4())[:8]
    lyrics_jobs[job_id] = {
        "folder": folder,
        "total": len(mp3s),
        "finished": False,
        "cancelled": False,
        "items": [
            {
                "file": f,
                "status": "pending",
                "error": None,
                "main_method": None,
                "sources": {m: {"status": "pending", "error": None, "text": None} for m in LYRICS_SOURCE_ORDER},
            }
            for f in mp3s
        ],
    }

    thread = threading.Thread(target=_process_lyrics_job, args=(job_id,), daemon=True)
    thread.start()
    return jsonify({"job_id": job_id, "total": len(mp3s)})


@app.route("/api/generate-lyrics/status/<job_id>")
def lyrics_job_status(job_id: str):
    job = lyrics_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    items = job["items"]
    done = sum(1 for i in items if i["status"] == "done")
    not_found = sum(1 for i in items if i["status"] == "not_found")
    cancelled = sum(1 for i in items if i["status"] == "cancelled")
    return jsonify({
        "total": job["total"],
        "processed": done + not_found + cancelled,
        "done": done,
        "not_found": not_found,
        "finished": job["finished"],
        "cancelled": job.get("cancelled", False),
        "items": [
            {
                "file": i["file"],
                # "error" is an internal retry-in-progress state — never surfaced to the client,
                # it always resolves to done/not_found by the time the job finishes.
                "status": "processing" if i["status"] == "error" else i["status"],
                "error": i.get("error"),
                "found_count": sum(1 for s in i["sources"].values() if s["status"] == "found"),
            }
            for i in items
        ],
    })


@app.route("/api/generate-lyrics/stop/<job_id>", methods=["POST"])
def stop_lyrics_job(job_id: str):
    job = lyrics_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    job["cancelled"] = True
    return jsonify({"ok": True})


# Fetching lyrics is network-bound (a handful of HTTP calls per song to free lyric
# APIs) with only trivial local CPU/disk work (ID3 read/write) — nothing like the
# download job's video transcoding, so it tolerates far more concurrency locally.
# The real ceiling is politeness toward the free, unauthenticated APIs behind it
# (LRCLIB/NetEase/Megalobiz), not local resources — if failed/not_found counts climb
# noticeably compared to a lower worker count, that's rate-limiting; dial this back.
LYRICS_WORKERS = 50
LYRICS_MAX_RETRY_CYCLES = 10


def _derive_lyrics_status(sources: dict) -> str:
    """Song-level status from per-source outcomes: error (still has a source worth retrying)
    beats processing (a source hasn't been reached at all yet — only possible right after
    seeding, since a full processing pass always resolves every pending/error source it sees)
    beats done (at least one source found something) beats not_found (every source reached,
    none found)."""
    statuses = [s["status"] for s in sources.values()]
    if "error" in statuses:
        return "error"
    if "pending" in statuses:
        return "processing"
    if "found" in statuses:
        return "done"
    return "not_found"


def _seed_lyrics_sources(item: dict, folder: str, existing_files: set[str], not_found: set[str]) -> None:
    """A source's backup file ({basename}.{method}.lrc) is written the moment that source is
    found and never touched again, so its presence on disk — from this job's own earlier work
    or a completely separate past run — is a trustworthy signal that source already succeeded.
    Seed it in so it's never re-queried.

    `not_found` is that same idea for the opposite outcome: methods the db remembers as having
    turned up nothing for this song on a past run (see db.get_lyrics_not_found). It only applies
    when the backup file isn't there — if the backup file reappeared (or was never queried),
    that takes priority and the source gets a real chance."""
    base = os.path.splitext(item["file"])[0]
    for method in LYRICS_SOURCE_ORDER:
        name = f"{base}.{method}.lrc"
        if name in existing_files:
            try:
                with open(os.path.join(folder, name), "r", encoding="utf-8") as f:
                    text = f.read()
                if text.strip():
                    item["sources"][method] = {"status": "found", "error": None, "text": text}
                    continue
            except Exception:
                pass  # leave it pending — it'll just be fetched normally
        if method in not_found:
            item["sources"][method] = {"status": "not_found", "error": None, "text": None}


def _write_main_lyrics(filepath: str, text: str) -> None:
    """Write `text` as the song's main lyrics: the ID3 USLT tag, and the unsuffixed
    {basename}.lrc sidecar if it's synced (removing that sidecar if the new main is plain text).
    Shared by the batch job's auto priority-swap (_sync_lyrics_files) and the manual
    set-source endpoint (set_lyrics_source)."""
    try:
        try:
            tags = ID3(filepath)
        except ID3NoHeaderError:
            audio = MP3(filepath)
            audio.add_tags()
            audio.save()
            tags = ID3(filepath)

        tags.delall("USLT")
        tags.add(USLT(encoding=3, lang="eng", desc="", text=text))
        tags.save()

        lrc_path = filepath.rsplit(".", 1)[0] + ".lrc"
        if text.lstrip().startswith("["):
            with open(lrc_path, "w", encoding="utf-8") as f:
                f.write(text)
        elif os.path.exists(lrc_path):
            os.remove(lrc_path)
    except Exception as e:
        log.warning("[lyrics] Failed to write ID3/main .lrc for %s: %s", filepath, e)


def _sync_lyrics_files(item: dict, filepath: str) -> None:
    """Make sure the ID3 tag / unsuffixed .lrc reflect the highest-priority source found so far.
    Every found source already has its own {basename}.{method}.lrc backup file (written the
    moment it's found, see process_item), so nothing needs to happen to the previous main when
    the pick shifts — it already has its own file from when it was found."""
    sources = item["sources"]
    best = next((m for m in LYRICS_SOURCE_ORDER if sources[m]["status"] == "found"), None)
    if not best or item.get("main_method") == best:
        return

    _write_main_lyrics(filepath, sources[best]["text"])
    item["main_method"] = best
    log.info("[gen-lyrics] ✓ %s (main: %s)", item["file"], best)


def _write_lyrics_backup(filepath: str, method: str, text: str) -> None:
    backup_path = filepath.rsplit(".", 1)[0] + f".{method}.lrc"
    try:
        with open(backup_path, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception as e:
        log.warning("[gen-lyrics] Failed to save %s backup for %s: %s", method, filepath, e)


def _process_lyrics_job(job_id: str):
    job = lyrics_jobs[job_id]
    folder = job["folder"]
    log.info("[gen-lyrics %s] Starting for %d files in %s (%d workers)", job_id, job["total"], folder, LYRICS_WORKERS)
    _prevent_sleep()

    # Stagger thread starts slightly so a burst of workers doesn't all hit the
    # same free API in the same instant — still runs fully concurrently otherwise.
    throttle_lock = threading.Lock()
    last_start = {"t": 0.0}

    def throttle():
        with throttle_lock:
            elapsed = time.time() - last_start["t"]
            if elapsed < 0.15:
                time.sleep(0.15 - elapsed)
            last_start["t"] = time.time()

    def process_item(item):
        if job.get("cancelled"):
            item["status"] = "cancelled"
            return
        throttle()
        if job.get("cancelled"):
            item["status"] = "cancelled"
            return

        filepath = os.path.join(folder, item["file"])
        item["status"] = "processing"

        # Extract artist/title from ID3 tags
        artist, title = None, None
        try:
            tags = ID3(filepath)
            tpe1 = tags.get("TPE1")
            tit2 = tags.get("TIT2")
            if tpe1:
                artist = str(tpe1)
            if tit2:
                title = str(tit2)
        except Exception:
            pass

        # Fallback: parse from filename
        if not title:
            name = os.path.splitext(item["file"])[0]
            if " - " in name:
                parts = name.split(" - ", 1)
                artist = parts[0].strip()
                title = parts[1].strip()
            else:
                title = name

        query = f"{artist} {title}" if artist else title
        sources = item["sources"]
        pending_methods = [m for m in LYRICS_SOURCE_ORDER if sources[m]["status"] in ("pending", "error")]

        try:
            for method in pending_methods:
                text, error = fetch_lyrics_from_source(method, artist, title, query)
                if text:
                    sources[method] = {"status": "found", "error": None, "text": text}
                    _write_lyrics_backup(filepath, method, text)
                    log.info("[gen-lyrics] ✓ %s via %s", item["file"], method)
                elif error:
                    sources[method] = {"status": "error", "error": error, "text": None}
                    log.warning("[gen-lyrics] %s error for %s: %s", method, item["file"], error)
                else:
                    sources[method] = {"status": "not_found", "error": None, "text": None}
                    db.mark_lyrics_not_found(filepath, method)
        except Exception as e:
            # Something unexpected (not a per-source fetch failure, which fetch_lyrics_from_source
            # already turns into (None, error)) — mark whatever we didn't get to as errored so
            # it's retried next cycle instead of silently staying "pending" forever.
            log.error("[gen-lyrics] Unexpected error processing %s: %s", item["file"], e)
            for method in pending_methods:
                if sources[method]["status"] == "pending":
                    sources[method] = {"status": "error", "error": str(e), "text": None}

        _sync_lyrics_files(item, filepath)
        item["status"] = _derive_lyrics_status(sources)
        if item["status"] == "not_found":
            item["error"] = "No lyrics found"
            log.info("[gen-lyrics] ✗ No lyrics: %s", item["file"])

    # Seed already-resolved sources from existing backup files and past not-found results
    # before doing any network calls — a song where every source is already accounted for
    # (found on disk, or remembered as not_found) resolves right here with zero fetches.
    existing_files = set(os.listdir(folder))
    not_found_map = db.get_lyrics_not_found([os.path.join(folder, item["file"]) for item in job["items"]])
    for item in job["items"]:
        filepath = os.path.join(folder, item["file"])
        _seed_lyrics_sources(item, folder, existing_files, not_found_map.get(filepath, set()))
        _sync_lyrics_files(item, filepath)
        derived = _derive_lyrics_status(item["sources"])
        if derived != "processing":
            item["status"] = derived
            if derived == "not_found":
                item["error"] = "No lyrics found"

    for cycle in range(LYRICS_MAX_RETRY_CYCLES):
        if job.get("cancelled"):
            break
        to_process = [i for i in job["items"] if i["status"] in ("pending", "error")]
        if not to_process:
            break
        if cycle > 0:
            log.info("[gen-lyrics %s] Retry cycle %d — %d songs remaining", job_id, cycle, len(to_process))
            time.sleep(5 + random.uniform(1, 5))
        with ThreadPoolExecutor(max_workers=LYRICS_WORKERS) as pool:
            futures = [pool.submit(process_item, item) for item in to_process if not job.get("cancelled")]
            for f in futures:
                f.result()

    # Exhausted the retry budget (or ran out of work) — any song still stuck on an erroring
    # source gives up on that source (treated as not-found) so "error" never becomes a final
    # state; the dashboard only ever shows Done / Not found / Cancelled.
    for item in job["items"]:
        if item["status"] == "error":
            for s in item["sources"].values():
                if s["status"] == "error":
                    s["status"] = "not_found"
            item["status"] = _derive_lyrics_status(item["sources"])
            if item["status"] == "not_found":
                item["error"] = "No lyrics found"
        if item["status"] == "pending":
            item["status"] = "cancelled"

    job["finished"] = True
    found = sum(1 for i in job["items"] if i["status"] == "done")
    not_found = sum(1 for i in job["items"] if i["status"] == "not_found")
    cancelled = sum(1 for i in job["items"] if i["status"] == "cancelled")
    log.info(
        "[gen-lyrics %s] %s — %d found, %d not found, %d skipped (cancelled)",
        job_id, "Cancelled" if job.get("cancelled") else "Finished", found, not_found, cancelled,
    )
    _allow_sleep()


def _write_playlist_m3u8(folder: str, name: str, songs: list[str]) -> str:
    """Sanitizes `name` and (re)writes that .m3u8 with this exact song list. Returns the
    sanitized name actually used, shared by the playlist/update route and backup import."""
    safe_name = re.sub(r'[<>:"/\\|?*]', '', name).strip()
    pl_path = os.path.join(folder, f"{safe_name}.m3u8")
    with open(pl_path, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for song_path in songs:
            f.write(f"{os.path.basename(song_path)}\n")
    return safe_name


def _read_playlist_songs(folder: str, pl_path: str) -> list[str]:
    """Reads a .m3u8's song entries, resolving each into a full path against `folder`.
    Playlists are written with bare filenames (the portable form: copy the whole music
    folder anywhere — another PC, a phone — and the playlist still resolves), but a full
    path is accepted too so older files written before this convention still work."""
    songs = []
    try:
        with open(pl_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                songs.append(line if os.path.isabs(line) else os.path.join(folder, line))
    except OSError:
        pass
    return songs


@app.route("/api/playlists", methods=["POST"])
def create_playlists():
    data = request.get_json()
    folder = data.get("folder", "").strip()
    lines = data.get("lines", [])

    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder path"}), 400

    # If no lines provided, read existing .m3u8 playlists from the folder
    if not lines:
        playlists_out = []
        for f in sorted(os.listdir(folder)):
            if not f.lower().endswith(".m3u8"):
                continue
            pl_path = os.path.join(folder, f)
            name = os.path.splitext(f)[0]
            songs = _read_playlist_songs(folder, pl_path)
            playlists_out.append({"name": name, "path": pl_path, "songs": songs})
        return jsonify({"playlists": playlists_out})

    queries, playlists = parse_playlist_input(lines)
    if not playlists:
        return jsonify({"error": "No playlists found. Use --playlistadd name / --playlistend syntax."}), 400

    # Scan folder for all MP3 files
    mp3_files = {}
    for f in os.listdir(folder):
        if f.lower().endswith(".mp3"):
            mp3_files[f.lower()] = os.path.join(folder, f)

    # Match each query to an MP3 by sanitized filename
    query_to_file: dict[int, str] = {}
    for idx, q in enumerate(queries):
        safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in q).strip()
        safe = re.sub(r'[\s_]*mp3$', '', safe, flags=re.IGNORECASE).strip()
        candidate = f"{safe}.mp3".lower()
        if candidate in mp3_files:
            query_to_file[idx] = mp3_files[candidate]
        else:
            # Fuzzy: check if query words all appear in any filename
            words = q.lower().split()
            for fname, fpath in mp3_files.items():
                if all(w in fname for w in words):
                    query_to_file[idx] = fpath
                    break

    results = []
    for name, indices in playlists.items():
        paths = [query_to_file[i] for i in indices if i in query_to_file]
        not_found = [queries[i] for i in indices if i not in query_to_file]
        if paths:
            pl_path = generate_playlist(paths, name, folder)
            results.append({"name": name, "file": pl_path, "tracks": len(paths), "missing": not_found})
        else:
            results.append({"name": name, "file": None, "tracks": 0, "missing": not_found})

    return jsonify({"playlists": results})


@app.route("/api/scan", methods=["POST"])
def scan_folder():
    data = request.get_json()
    folder = data.get("folder", "").strip()
    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder path"}), 400

    start = time.time()
    songs = _scan_songs(folder)
    issues = find_library_issues_from_songs(songs, folder)
    log.info(
        "[scan] %s — %d songs, %d duplicate groups, %d corrupt-only files (%.2fs)",
        folder, len(songs), len(issues["duplicate_groups"]), len(issues["standalone_corrupt"]),
        time.time() - start,
    )
    return jsonify({"songs": songs, "issues": issues})


def _scan_songs(folder: str) -> list[dict]:
    """Read all MP3s in folder, using the db cache for unchanged files."""
    # Build a map of cached songs keyed by path
    cached = {s["path"]: s for s in db.get_cached_songs(folder)}
    current_paths = set()
    songs = []

    for f in sorted(os.listdir(folder)):
        if not f.lower().endswith(".mp3"):
            continue
        filepath = os.path.join(folder, f)
        current_paths.add(filepath)

        try:
            stat = os.stat(filepath)
            file_size = stat.st_size
            last_modified = stat.st_mtime
        except OSError:
            continue

        # Use cache if file hasn't changed
        c = cached.get(filepath)
        if c and c["file_size"] == file_size and abs(c["last_modified"] - last_modified) < 1:
            song = {
                "id": filepath, "path": filepath,
                "title": c["title"], "artist": c["artist"], "album": c["album"],
                "duration": c["duration"], "size": file_size, "has_lyrics": bool(c["has_lyrics"]),
                "genre": c.get("genre", ""),
            }
            if c.get("track"):
                song["track"] = c["track"]
            if c.get("year"):
                song["year"] = c["year"]
            if c["has_artwork"]:
                song["artwork"] = f"/api/cover?path={urllib.parse.quote(os.path.basename(filepath))}"
            songs.append(song)
            continue

        # Read ID3 tags for new/modified files
        song = {"id": filepath, "path": filepath, "title": "", "artist": "", "album": "", "duration": 0, "size": file_size, "genre": ""}
        has_artwork = False
        has_lyrics = False
        track = None
        year = None
        genre = ""
        try:
            audio = MP3(filepath)
            song["duration"] = round(audio.info.length)
            tags = audio.tags
            if tags:
                song["title"] = str(tags.get("TIT2", "")) or ""
                song["artist"] = str(tags.get("TPE1", "")) or ""
                song["album"] = str(tags.get("TALB", "")) or ""
                # Plain str(tag) doesn't resolve legacy ID3v1 numeric genre codes like "(17)"
                # into their names ("Rock") — .genres does exactly what Explorer's Properties
                # panel does, handling both plain-text and numeric-coded tags.
                tcon = tags.get("TCON")
                genre = ", ".join(tcon.genres) if tcon and tcon.genres else ""
                song["genre"] = genre
                trck = tags.get("TRCK")
                if trck:
                    try:
                        track = int(str(trck).split("/")[0])
                        song["track"] = track
                    except (ValueError, IndexError):
                        pass
                tdrc = tags.get("TDRC")
                if tdrc:
                    try:
                        year = int(str(tdrc)[:4])
                        song["year"] = year
                    except (ValueError, IndexError):
                        pass
                has_artwork = bool(tags.getall("APIC"))
                has_lyrics = bool(tags.getall("USLT"))
                if has_artwork:
                    song["artwork"] = f"/api/cover?path={urllib.parse.quote(os.path.basename(filepath))}"
        except Exception:
            pass
        if not song["title"]:
            name = os.path.splitext(f)[0]
            if " - " in name:
                parts = name.split(" - ", 1)
                song["artist"] = song["artist"] or parts[0].strip()
                song["title"] = parts[1].strip()
            else:
                song["title"] = name

        song["has_lyrics"] = has_lyrics

        # Cache in db
        db.upsert_song(filepath, song["title"], song["artist"], song.get("album", ""),
                       song["duration"], track, year, has_artwork, has_lyrics,
                       file_size, last_modified, genre)
        songs.append(song)

    # Remove stale entries for deleted files
    db.remove_stale_songs(folder, current_paths)
    return songs


def _normalize_key(text: str) -> str:
    """Lowercase, punctuation-insensitive key used to match the same song across
    filenames/tags that differ only in formatting (the classic "different app version" dupe)."""
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _build_related_index(folder: str, mp3_paths: list[str]) -> dict[str, list[str]]:
    """Map each mp3 path to its .lrc sidecar files (main + {method}.lrc backups), built
    from a single directory listing instead of a glob() per file — the previous version
    re-listed the whole folder for every candidate file, which is what made duplicate
    detection slow to the point of feeling hung on a 1000+ song library."""
    bases = {os.path.splitext(os.path.basename(p))[0]: p for p in mp3_paths}
    # Longest-first so a dot-containing title (e.g. "T.N.T.") wins over a shorter prefix
    sorted_bases = sorted(bases.keys(), key=len, reverse=True)
    index: dict[str, list[str]] = {p: [] for p in mp3_paths}

    for f in os.listdir(folder):
        if not f.lower().endswith(".lrc"):
            continue
        stem = f[:-4]  # strip ".lrc"
        base = stem if stem in bases else next((b for b in sorted_bases if stem.startswith(b + ".")), None)
        if base:
            index[bases[base]].append(os.path.join(folder, f))

    return index


def find_library_issues_from_songs(songs: list[dict], folder: str) -> dict:
    """Group already-scanned songs by normalized Artist+Title and flag corrupt files.
    Runs entirely on data _scan_songs already produced (cached where possible) — no
    second mutagen pass over the library, so this stays fast at any library size.
    For each duplicate group, the file to keep is picked by: does its filename match
    the app's own naming convention ("Artist - Title.mp3")? Re-downloads from an older
    app version are usually near-identical in size (same yt-dlp quality settings), so
    size is a weak signal here — correct naming is the stronger tell of "the good copy",
    with size/completeness only as tiebreakers. Every other file in the group (including
    corrupt ones) is a removal candidate. A group where every copy is corrupt has no
    keeper — the whole song would be lost."""
    related_index = _build_related_index(folder, [s["path"] for s in songs])

    def is_corrupt(s: dict) -> bool:
        return (s.get("duration") or 0) <= 0

    def corrupt_reason(s: dict) -> str:
        return "File is empty (0 bytes)" if not s.get("size") else "No readable audio track (corrupt file)"

    def matches_naming_convention(s: dict) -> bool:
        if not s.get("artist") or not s.get("title"):
            return False
        expected = sanitize_filename(f"{s['artist']} - {s['title']}") + ".mp3"
        return os.path.basename(s["path"]).lower() == expected.lower()

    groups: dict[str, list[dict]] = {}
    for s in songs:
        key = f"{_normalize_key(s.get('artist', ''))}|{_normalize_key(s.get('title', ''))}"
        groups.setdefault(key, []).append(s)

    duplicate_groups = []
    standalone_corrupt = []

    for items in groups.values():
        if len(items) == 1:
            s = items[0]
            if is_corrupt(s):
                standalone_corrupt.append({
                    "path": s["path"], "size": s.get("size", 0), "reason": corrupt_reason(s),
                    "related": related_index.get(s["path"], []),
                })
            continue

        healthy = [s for s in items if not is_corrupt(s)]
        keeper = max(
            healthy,
            key=lambda s: (
                matches_naming_convention(s),
                s.get("size", 0),
                int(bool(s.get("artwork"))) + int(bool(s.get("has_lyrics"))),
            ),
        ) if healthy else None

        files = [{
            "path": s["path"], "size": s.get("size", 0),
            "corrupt": is_corrupt(s), "corrupt_reason": corrupt_reason(s) if is_corrupt(s) else None,
            "has_artwork": bool(s.get("artwork")), "has_lyrics": bool(s.get("has_lyrics")),
            "keep": keeper is not None and s["path"] == keeper["path"],
            "related": related_index.get(s["path"], []),
        } for s in items]
        files.sort(key=lambda f: (not f["keep"], -f["size"]))

        duplicate_groups.append({
            "artist": items[0].get("artist") or "Unknown",
            "title": items[0].get("title") or "",
            "keep": keeper["path"] if keeper else None,
            "all_corrupt": keeper is None,
            "files": files,
        })

    duplicate_groups.sort(key=lambda g: (g["artist"].lower(), g["title"].lower()))
    return {"duplicate_groups": duplicate_groups, "standalone_corrupt": standalone_corrupt}


@app.route("/api/library/resolve-issues", methods=["POST"])
def library_resolve_issues():
    """Delete a confirmed set of files (mp3s and/or their .lrc sidecars). The frontend
    doesn't ask the user to pick individual files — it sends every non-keeper path from
    the last scan's `issues` report as one bulk action. Only ever deletes files that
    resolve inside the given folder, as a backend-side safety net regardless of what
    the frontend sends."""
    data = request.get_json()
    folder = data.get("folder", "").strip()
    delete_paths = data.get("delete", [])
    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder path"}), 400

    folder_real = os.path.realpath(folder)
    deleted = []
    for path in delete_paths:
        if not isinstance(path, str):
            continue
        real = os.path.realpath(path)
        try:
            if os.path.commonpath([folder_real, real]) != folder_real:
                continue
        except ValueError:
            continue  # different drive on Windows
        if not real.lower().endswith((".mp3", ".lrc")):
            continue
        try:
            if os.path.isfile(real):
                os.remove(real)
                deleted.append(path)
        except OSError as e:
            log.warning("[library] Failed to delete %s: %s", real, e)

    log.info("[library] Deleted %d/%d requested files in %s", len(deleted), len(delete_paths), folder)
    songs = _scan_songs(folder)
    issues = find_library_issues_from_songs(songs, folder)
    return jsonify({"deleted": deleted, "songs": songs, "issues": issues})


@app.route("/api/song/delete", methods=["POST"])
def delete_song():
    """Deletes one song: the mp3 itself, its main .lrc sidecar, and any
    {method}.lrc backups (embedded ID3 metadata goes with the file). Also strips the
    song from any .m3u8 playlists that reference it, so nothing dangling is left behind."""
    data = request.get_json()
    folder = data.get("folder", "").strip()
    path = data.get("path", "").strip()
    if not folder or not os.path.isdir(folder) or not path:
        return jsonify({"error": "Invalid folder or path"}), 400

    folder_real = os.path.realpath(folder)
    real = os.path.realpath(path)
    try:
        if os.path.commonpath([folder_real, real]) != folder_real:
            return jsonify({"error": "Path is outside the music folder"}), 400
    except ValueError:
        return jsonify({"error": "Path is outside the music folder"}), 400
    if not real.lower().endswith(".mp3"):
        return jsonify({"error": "Not an mp3 file"}), 400

    base = os.path.splitext(os.path.basename(real))[0]
    deleted = []

    if os.path.isfile(real):
        try:
            os.remove(real)
            deleted.append(real)
        except OSError as e:
            log.warning("[library] Failed to delete %s: %s", real, e)
            return jsonify({"error": f"Couldn't delete file: {e}"}), 500

    for f in os.listdir(folder):
        if not f.lower().endswith(".lrc"):
            continue
        stem = f[:-4]
        if stem == base or stem.startswith(base + "."):
            lrc_path = os.path.join(folder, f)
            try:
                os.remove(lrc_path)
                deleted.append(lrc_path)
            except OSError as e:
                log.warning("[library] Failed to delete %s: %s", lrc_path, e)

    # Strip this song from any .m3u8 playlists that reference it (entries are usually
    # just the bare filename now, but older files may still hold a full path).
    updated_playlists = []
    for f in os.listdir(folder):
        if not f.lower().endswith(".m3u8"):
            continue
        pl_path = os.path.join(folder, f)
        try:
            with open(pl_path, "r", encoding="utf-8") as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        kept = [ln for ln in lines if ln.strip() not in (path, real, base + ".mp3")]
        if len(kept) != len(lines):
            with open(pl_path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(kept) + ("\n" if kept else ""))
            updated_playlists.append(os.path.splitext(f)[0])

    log.info(
        "[library] Deleted song %s (%d file(s), removed from %d playlist(s))",
        real, len(deleted), len(updated_playlists),
    )
    songs = _scan_songs(folder)
    return jsonify({"ok": True, "deleted": deleted, "updated_playlists": updated_playlists, "songs": songs})


@app.route("/api/browse", methods=["POST"])
def browse_folder():
    if IN_DOCKER:
        return jsonify({"folder": db.get_setting("musicFolder", "")})
    # Native/exe: use system file picker
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Select Music Folder")
        root.destroy()
        if not folder:
            return jsonify({"folder": None})
        return jsonify({"folder": folder})
    except Exception:
        return jsonify({"folder": db.get_setting("musicFolder", "")})


# ── Library endpoints (local file playback) ──

@app.route("/api/library")
def get_library():
    folder = request.args.get("folder", "").strip()
    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder path"}), 400

    return jsonify({"songs": _scan_songs(folder)})


@app.route("/api/file")
def stream_local_file():
    path = request.args.get("path", "").strip()
    if not path or not os.path.isfile(path) or not path.lower().endswith(".mp3"):
        return jsonify({"error": "Not found"}), 404

    file_size = os.path.getsize(path)
    range_header = request.headers.get("Range")

    if range_header:
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1

            def generate():
                with open(path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(8192, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            resp = Response(generate(), status=206, mimetype="audio/mpeg")
            resp.headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            resp.headers["Content-Length"] = str(length)
            resp.headers["Accept-Ranges"] = "bytes"
            return resp

    return send_file(path, mimetype="audio/mpeg", conditional=True)


def _raw_cover(path: str) -> tuple[bytes, str] | None:
    tags = ID3(path)
    apics = tags.getall("APIC")
    if not apics:
        return None
    return apics[0].data, (apics[0].mime or "image/jpeg")


@lru_cache(maxsize=1024)
def _resized_cover_bytes(path: str, mtime: float, size: int) -> bytes | None:
    """Downscaled JPEG for a given (file, size) pair. `mtime` is part of the cache key purely
    so a re-tagged/replaced file invalidates automatically — it's never read as a timestamp.
    Embedded album art comes in at 600x600+ (sometimes much larger) straight from the metadata
    lookup; serving that untouched for every 36px table row / 40px queue thumbnail was the
    single biggest driver of decode CPU and memory — a decoded 600x600 bitmap is ~1.4MB
    regardless of the box it's painted into, and there was no cache header telling the browser
    it could avoid re-fetching it. This resizes once per (file, size) and is cheap after that."""
    raw = _raw_cover(path)
    if raw is None:
        return None
    img = Image.open(io.BytesIO(raw[0]))
    img = img.convert("RGB")
    img.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@app.route("/api/cover")
def get_cover():
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "Not found"}), 404

    # If only a filename was passed, resolve it against the configured music folder
    if not os.path.isabs(path):
        folder = music_folder()
        if not folder:
            return jsonify({"error": "Not found"}), 404
        path = os.path.join(folder, path)

    if not os.path.isfile(path):
        return jsonify({"error": "Not found"}), 404

    size = request.args.get("size", type=int)
    try:
        if size:
            size = max(16, min(size, 1024))
            data = _resized_cover_bytes(path, os.path.getmtime(path), size)
            if data is None:
                return jsonify({"error": "No artwork"}), 404
            resp = Response(data, mimetype="image/jpeg")
        else:
            raw = _raw_cover(path)
            if raw is None:
                return jsonify({"error": "No artwork"}), 404
            resp = Response(raw[0], mimetype=raw[1])
        # Art rarely changes once tagged, and the cache key above already accounts for it
        # when it does — safe to let the browser hold onto this for a long time.
        resp.headers["Cache-Control"] = "public, max-age=604800"
        return resp
    except Exception:
        return jsonify({"error": "No artwork"}), 404


def _read_main_lyrics(path: str) -> str | None:
    """The song's current main lyrics: the embedded USLT tag, falling back to the unsuffixed
    {basename}.lrc sidecar."""
    try:
        tags = ID3(path)
        uslts = tags.getall("USLT")
        if uslts and uslts[0].text:
            return uslts[0].text
    except Exception:
        pass

    lrc_path = path.rsplit(".", 1)[0] + ".lrc"
    if os.path.isfile(lrc_path):
        try:
            with open(lrc_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass

    return None


@app.route("/api/local-lyrics")
def get_local_lyrics():
    path = request.args.get("path", "").strip()
    if not path or not os.path.isfile(path):
        return jsonify({"lyrics": None})
    return jsonify({"lyrics": _read_main_lyrics(path)})


@app.route("/api/lyrics/sources")
def get_lyrics_sources():
    """Every lyrics source that has ever succeeded for this song — each one already has its own
    {basename}.{method}.lrc backup on disk (written the moment it was found, see
    _write_lyrics_backup) — tagged with whether it's synced and whether it's the current main."""
    path = request.args.get("path", "").strip()
    if not path or not os.path.isfile(path):
        return jsonify({"sources": []})

    current = _read_main_lyrics(path)
    base = os.path.splitext(os.path.basename(path))[0]
    folder = os.path.dirname(path)

    sources = []
    for method in LYRICS_SOURCE_ORDER:
        backup_path = os.path.join(folder, f"{base}.{method}.lrc")
        if not os.path.isfile(backup_path):
            continue
        try:
            with open(backup_path, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception:
            continue
        if not text.strip():
            continue
        sources.append({
            "method": method,
            "synced": text.lstrip().startswith("["),
            "active": text == current,
            "text": text,
        })

    return jsonify({"sources": sources})


@app.route("/api/lyrics/set-source", methods=["POST"])
def set_lyrics_source():
    """Switch a song's main lyrics to one of its already-found sources — persists like the
    batch job's auto priority-swap, just picked by the user instead of LYRICS_SOURCE_ORDER."""
    data = request.get_json()
    path = data.get("path", "").strip()
    method = data.get("method", "").strip()
    if not path or not os.path.isfile(path) or method not in LYRICS_SOURCE_ORDER:
        return jsonify({"error": "Invalid path or method"}), 400

    base = os.path.splitext(os.path.basename(path))[0]
    backup_path = os.path.join(os.path.dirname(path), f"{base}.{method}.lrc")
    if not os.path.isfile(backup_path):
        return jsonify({"error": "No lyrics found for that source"}), 404

    try:
        with open(backup_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return jsonify({"error": "Failed to read lyrics"}), 500

    _write_main_lyrics(path, text)
    return jsonify({"ok": True, "lyrics": text, "synced": text.lstrip().startswith("[")})


_LRC_TIME_RE = re.compile(r"^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]", re.MULTILINE)


def _shift_lrc_timestamps(text: str, delta: float) -> str:
    """Rewrite every [mm:ss.xx] timestamp in an LRC file by delta seconds (clamped to >= 0).
    Uses re.sub rather than splitting into lines and rejoining: it only touches the matched
    timestamp brackets, so blank lines, trailing newlines, and metadata tags like [ar:...] (which
    never match — they don't start with digits) come through completely untouched."""

    def repl(m: re.Match) -> str:
        minutes, seconds, frac = m.groups()
        frac_val = (int(frac) / (10 if len(frac) == 1 else 100)) if frac else 0.0
        total = round(max(0.0, int(minutes) * 60 + int(seconds) + frac_val + delta), 2)
        new_minutes, new_seconds = divmod(total, 60)
        return f"[{int(new_minutes):02d}:{new_seconds:05.2f}]"

    return _LRC_TIME_RE.sub(repl, text)


@app.route("/api/lyrics/shift-offset", methods=["POST"])
def shift_lyrics_offset():
    """Permanently corrects one source's saved timing by delta seconds — rewrites its
    {basename}.{method}.lrc backup directly (no runtime/display-only offset). If that source is
    currently the song's main lyrics, the ID3 tag / main .lrc are updated too so they don't go
    stale relative to the corrected backup."""
    data = request.get_json()
    path = data.get("path", "").strip()
    method = data.get("method", "").strip()
    delta = data.get("delta")
    if (
        not path
        or not os.path.isfile(path)
        or method not in LYRICS_SOURCE_ORDER
        or not isinstance(delta, (int, float))
    ):
        return jsonify({"error": "Invalid request"}), 400

    base = os.path.splitext(os.path.basename(path))[0]
    backup_path = os.path.join(os.path.dirname(path), f"{base}.{method}.lrc")
    if not os.path.isfile(backup_path):
        return jsonify({"error": "No lyrics found for that source"}), 404

    try:
        with open(backup_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return jsonify({"error": "Failed to read lyrics"}), 500

    if not text.lstrip().startswith("["):
        return jsonify({"error": "Source is not synced"}), 400

    is_main = text == _read_main_lyrics(path)
    shifted = _shift_lrc_timestamps(text, float(delta))

    try:
        with open(backup_path, "w", encoding="utf-8") as f:
            f.write(shifted)
    except Exception as e:
        log.warning("[lyrics] Failed to save shifted %s backup for %s: %s", method, path, e)
        return jsonify({"error": "Failed to save"}), 500

    if is_main:
        _write_main_lyrics(path, shifted)

    return jsonify({"ok": True, "lyrics": shifted})


# ── Playlist CRUD endpoints ──

@app.route("/api/playlist/create", methods=["POST"])
def create_playlist():
    data = request.get_json()
    folder = data.get("folder", "").strip()
    name = data.get("name", "").strip()
    if not folder or not os.path.isdir(folder) or not name:
        return jsonify({"error": "Invalid folder or name"}), 400

    safe_name = re.sub(r'[<>:"/\\|?*]', '', name).strip()
    if not safe_name:
        return jsonify({"error": "Invalid playlist name"}), 400

    pl_path = os.path.join(folder, f"{safe_name}.m3u8")
    if not os.path.exists(pl_path):
        with open(pl_path, "w", encoding="utf-8") as f:
            f.write("#EXTM3U\n")

    return jsonify({"playlist": {"name": safe_name, "path": pl_path, "songs": []}})


@app.route("/api/playlist/update", methods=["POST"])
def update_playlist():
    data = request.get_json()
    folder = data.get("folder", "").strip()
    name = data.get("name", "").strip()
    songs = data.get("songs", [])
    if not folder or not os.path.isdir(folder) or not name:
        return jsonify({"error": "Invalid folder or name"}), 400

    safe_name = _write_playlist_m3u8(folder, name, songs)
    pl_path = os.path.join(folder, f"{safe_name}.m3u8")

    return jsonify({"playlist": {"name": safe_name, "path": pl_path, "songs": songs}})


@app.route("/api/playlist/delete", methods=["POST"])
def delete_playlist():
    data = request.get_json()
    folder = data.get("folder", "").strip()
    name = data.get("name", "").strip()
    if not folder or not os.path.isdir(folder) or not name:
        return jsonify({"error": "Invalid folder or name"}), 400

    safe_name = re.sub(r'[<>:"/\\|?*]', '', name).strip()
    pl_path = os.path.join(folder, f"{safe_name}.m3u8")
    if os.path.isfile(pl_path):
        os.remove(pl_path)

    return jsonify({"ok": True})


@app.route("/api/playlists/read", methods=["POST"])
def read_playlists():
    """Read all .m3u8 files in a folder and return playlist data."""
    data = request.get_json()
    folder = data.get("folder", "").strip()
    if not folder or not os.path.isdir(folder):
        return jsonify({"error": "Invalid folder"}), 400

    playlists = []
    for f in sorted(os.listdir(folder)):
        if not f.lower().endswith(".m3u8"):
            continue
        pl_path = os.path.join(folder, f)
        name = os.path.splitext(f)[0]
        songs = _read_playlist_songs(folder, pl_path)
        playlists.append({"name": name, "path": pl_path, "songs": songs})

    return jsonify({"playlists": playlists})


# ── Health check — Electron polls this to know the backend is up before loading the window ──

@app.route("/api/health")
def health():
    return jsonify({"ok": True})


# ── Settings endpoints ──

@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(db.get_all_settings())


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.get_json()
    for key, value in data.items():
        db.set_setting(key, str(value))
    return jsonify(db.get_all_settings())


# ── Backup / export ──
# Playlists (.m3u8) + settings only — never the audio files themselves, so the backup stays
# a small, portable JSON instead of duplicating the whole library.

@app.route("/api/backup/export", methods=["GET"])
def export_backup():
    folder = music_folder()
    playlists = []
    if folder and os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if not f.lower().endswith(".m3u8"):
                continue
            pl_path = os.path.join(folder, f)
            playlists.append({
                "name": os.path.splitext(f)[0],
                "songs": _read_playlist_songs(folder, pl_path),
            })

    payload = {
        "version": 1,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "settings": db.get_all_settings(),
        "playlists": playlists,
    }
    resp = Response(json.dumps(payload, indent=2), mimetype="application/json")
    resp.headers["Content-Disposition"] = 'attachment; filename="musicflow-backup.json"'
    return resp


@app.route("/api/backup/import", methods=["POST"])
def import_backup():
    data = request.get_json() or {}
    folder = music_folder()
    imported_settings = 0
    imported_playlists = 0
    warning = None

    for key, value in (data.get("settings") or {}).items():
        # This machine's own music folder is set locally — importing a backup taken
        # elsewhere shouldn't repoint it at a path that may not exist here.
        if key == "musicFolder":
            continue
        db.set_setting(key, str(value))
        imported_settings += 1

    playlists = data.get("playlists") or []
    if playlists and not (folder and os.path.isdir(folder)):
        warning = "No music folder configured — playlists were not restored."
    elif folder:
        for pl in playlists:
            name = str(pl.get("name", "")).strip()
            if not name:
                continue
            _write_playlist_m3u8(folder, name, pl.get("songs") or [])
            imported_playlists += 1

    result = {"ok": True, "imported_settings": imported_settings, "imported_playlists": imported_playlists}
    if warning:
        result["warning"] = warning
    return jsonify(result)


# ── Discord Rich Presence ──
# The frontend calls this on song-change / play-pause, not on every playback tick — Discord's
# own countdown is computed client-side from the start/end timestamps we send it once.

@app.route("/api/discord/update", methods=["POST"])
def discord_update():
    data = request.get_json() or {}
    enabled = db.get_setting("discordEnabled", "false") == "true"
    if not enabled:
        return jsonify({"ok": True, "active": False})
    discord_rpc.update(
        str(data.get("title", "")),
        str(data.get("artist", "")),
        bool(data.get("is_playing")),
        float(data.get("position") or 0),
        float(data.get("duration") or 0),
    )
    return jsonify({"ok": True, "active": True})


@app.route("/api/discord/clear", methods=["POST"])
def discord_clear():
    discord_rpc.clear()
    return jsonify({"ok": True})


# ── ListenBrainz scrobbling ──

def _scrobbling_config() -> tuple[str, bool]:
    token = db.get_setting("listenbrainzToken", "").strip()
    enabled = db.get_setting("scrobblingEnabled", "false") == "true"
    return token, enabled


@app.route("/api/scrobble/now-playing", methods=["POST"])
def scrobble_now_playing():
    data = request.get_json() or {}
    token, enabled = _scrobbling_config()
    if not enabled or not token:
        return jsonify({"ok": True, "active": False})
    scrobbling.now_playing(
        token, str(data.get("title", "")), str(data.get("artist", "")),
        str(data.get("album", "")), float(data.get("duration") or 0),
    )
    return jsonify({"ok": True, "active": True})


@app.route("/api/scrobble/listen", methods=["POST"])
def scrobble_listen():
    data = request.get_json() or {}
    token, enabled = _scrobbling_config()
    if not enabled or not token:
        return jsonify({"ok": True, "active": False})
    scrobbling.submit_listen(
        token, str(data.get("title", "")), str(data.get("artist", "")),
        str(data.get("album", "")), float(data.get("duration") or 0),
    )
    return jsonify({"ok": True, "active": True})


# ── Last.fm scrobbling ──
# Needs a one-time browser authorization per Last.fm account (unlike ListenBrainz's plain
# token) — auth-start hands the frontend a URL to open, auth-complete exchanges the token the
# user approved there for a permanent session key, stored server-side like everything else.

@app.route("/api/lastfm/auth-start", methods=["POST"])
def lastfm_auth_start():
    if not lastfm.configured():
        return jsonify({"error": "Last.fm isn't configured on this build yet"}), 400
    token = lastfm.get_auth_token()
    if not token:
        return jsonify({"error": "Couldn't reach Last.fm"}), 502
    return jsonify({"token": token, "url": lastfm.auth_url(token)})


@app.route("/api/lastfm/auth-complete", methods=["POST"])
def lastfm_auth_complete():
    data = request.get_json() or {}
    token = str(data.get("token", "")).strip()
    if not token:
        return jsonify({"error": "Missing token"}), 400
    session = lastfm.get_session(token)
    if not session:
        return jsonify({"error": "Not authorized yet — approve it in the browser tab first, then try again."}), 400
    db.set_setting("lastfmSessionKey", session["key"])
    db.set_setting("lastfmUsername", session.get("name", ""))
    return jsonify({"ok": True, "username": session.get("name", "")})


@app.route("/api/lastfm/disconnect", methods=["POST"])
def lastfm_disconnect():
    db.set_setting("lastfmSessionKey", "")
    db.set_setting("lastfmUsername", "")
    return jsonify({"ok": True})


def _lastfm_session() -> str:
    if db.get_setting("lastfmEnabled", "false") != "true":
        return ""
    return db.get_setting("lastfmSessionKey", "").strip()


@app.route("/api/lastfm/now-playing", methods=["POST"])
def lastfm_now_playing_route():
    data = request.get_json() or {}
    session_key = _lastfm_session()
    if not session_key:
        return jsonify({"ok": True, "active": False})
    lastfm.update_now_playing(
        session_key, str(data.get("artist", "")), str(data.get("title", "")),
        str(data.get("album", "")), float(data.get("duration") or 0),
    )
    return jsonify({"ok": True, "active": True})


@app.route("/api/lastfm/scrobble", methods=["POST"])
def lastfm_scrobble_route():
    data = request.get_json() or {}
    session_key = _lastfm_session()
    if not session_key:
        return jsonify({"ok": True, "active": False})
    lastfm.scrobble(
        session_key, str(data.get("artist", "")), str(data.get("title", "")),
        str(data.get("album", "")), float(data.get("duration") or 0), int(time.time()),
    )
    return jsonify({"ok": True, "active": True})


if __name__ == "__main__":
    folder = music_folder()
    print(f"\n  Music folder: {folder or '(not configured yet)'}\n")
    print(f"  Database: {db.DB_PATH}\n")
    # threaded=True matters: without it the dev server handles one request at a time,
    # so a long-lived request (e.g. audio streaming while a song plays) blocks every
    # other endpoint — including a scan — until it finishes.
    app.run(debug=False, port=5000, threaded=True)
