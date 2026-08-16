import glob
import json
import logging
import os
import random
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import yt_dlp
from mutagen.id3 import ID3, ID3NoHeaderError, USLT, TIT2, TPE1, TALB, TRCK, TDRC, TCON, APIC
from mutagen.mp3 import MP3

log = logging.getLogger("musicflow")


def rename_lyrics_backups(old_mp3_path: str, new_mp3_path: str) -> None:
    """Rename any {basename}.{method}.lrc backup files alongside a renamed/corrected mp3."""
    old_base = old_mp3_path.rsplit(".", 1)[0]
    new_base = new_mp3_path.rsplit(".", 1)[0]
    for backup_path in glob.glob(glob.escape(old_base) + ".*.lrc"):
        suffix = backup_path[len(old_base):]  # e.g. ".netease.lrc"
        try:
            os.rename(backup_path, new_base + suffix)
        except Exception:
            pass


def find_ffmpeg() -> str | None:
    # Check for a bundled ffmpeg first (PyInstaller build, or dev "bin" folder)
    if getattr(sys, "frozen", False):
        bundled = os.path.join(sys._MEIPASS, "bin", "ffmpeg.exe")
        if os.path.isfile(bundled):
            return os.path.dirname(bundled)
    else:
        dev_bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffmpeg.exe")
        if os.path.isfile(dev_bundled):
            return os.path.dirname(dev_bundled)

    path = shutil.which("ffmpeg")
    if path:
        return os.path.dirname(path)
    # Check common winget install location
    winget_dir = os.path.join(
        os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages"
    )
    if os.path.isdir(winget_dir):
        for folder in os.listdir(winget_dir):
            if "FFmpeg" in folder:
                bin_path = os.path.join(winget_dir, folder)
                for root, dirs, files in os.walk(bin_path):
                    if "ffmpeg.exe" in files:
                        return root
    return None


def get_first_video_link(query: str) -> tuple[str, str, str | None] | None:
    """Search YouTube and return the first result that is an actual video (not a channel)."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "noplaylist": True,
        "default_search": "ytsearch5",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(f"ytsearch5:{query}", download=False)
        if result and "entries" in result:
            entries = [e for e in result["entries"] if e]
            for entry in entries:
                # Only accept actual videos — skip playlists, channels, mixes, etc.
                entry_type = entry.get("_type", "video")
                ie_key = entry.get("ie_key") or ""
                if entry_type not in ("video", "url") or ie_key in ("YoutubeTab", "YoutubeUser", "YoutubeChannel", "YoutubePlaylist"):
                    continue
                url = entry.get("url") or (f"https://www.youtube.com/watch?v={entry['id']}" if entry.get("id") else None)
                if not url:
                    continue
                # Skip channel/user/playlist URLs that slipped through
                if any(seg in url for seg in ("/channel/", "/@", "/c/", "/user/", "/playlist?", "&list=")):
                    continue
                title = entry.get("title", query)
                thumbnail = entry.get("thumbnail")
                if not thumbnail:
                    thumbs = entry.get("thumbnails") or []
                    if thumbs:
                        thumbnail = sorted(thumbs, key=lambda t: (t.get("height") or 0))[-1].get("url")
                return url, title, thumbnail
    return None


def parse_artist_title(video_title: str) -> tuple[str | None, str]:
    """Extract artist and song title from a YouTube video title."""
    cleaned = re.sub(
        r'\s*[\(\[]\s*(official\s*(video|audio|music\s*video|lyric\s*video)|lyrics?|audio|hd|hq|4k|1080p|visualizer|explicit|clean)\s*[\)\]]',
        '', video_title, flags=re.IGNORECASE
    ).strip()
    cleaned = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]\s*$', '', cleaned).strip()
    if ' - ' in cleaned:
        parts = cleaned.split(' - ', 1)
        return parts[0].strip(), parts[1].strip()
    return None, cleaned


# Priority order used both by fetch_lyrics() (single-song flow) and the batch lyrics job in
# server.py (which retries only the sources that error, tracking each one individually).
LYRICS_SOURCE_ORDER = ["lrclib", "netease", "megalobiz", "musixmatch", "lrclib-exact", "lrclib-search"]


def fetch_lyrics_from_source(method: str, artist: str | None, title: str, query: str) -> tuple[str | None, str | None]:
    """Try exactly one lyrics source (no file writes). Returns (lyrics_text, error):
    - (text, None): found
    - (None, None): legitimate miss — the source has nothing for this song
    - (None, error): the request itself failed (timeout, connection error, etc.)"""
    from syncedlyrics.providers import Lrclib, NetEase, Megalobiz, Musixmatch
    from syncedlyrics.utils import TargetType

    # Suppress noisy syncedlyrics/Musixmatch internal logging
    logging.getLogger("syncedlyrics").setLevel(logging.WARNING)

    search_term = f"{artist} {title}" if artist else query

    if method in ("lrclib", "netease", "megalobiz", "musixmatch"):
        provider = {"lrclib": Lrclib, "netease": NetEase, "megalobiz": Megalobiz, "musixmatch": Musixmatch}[method]()
        try:
            lrc = provider.get_lrc(search_term)
            text = lrc.to_str(TargetType.PREFER_SYNCED) if lrc else None
            return (text, None) if text else (None, None)
        except Exception as e:
            return None, str(e)

    if method == "lrclib-exact":
        if not artist:
            return None, None
        try:
            url = f"https://lrclib.net/api/get?artist_name={urllib.parse.quote(artist)}&track_name={urllib.parse.quote(title)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Musicflow/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                text = data.get("syncedLyrics") or data.get("plainLyrics")
                return (text, None) if text else (None, None)
        except urllib.error.HTTPError:
            return None, None
        except Exception as e:
            return None, str(e)

    if method == "lrclib-search":
        try:
            url = f"https://lrclib.net/api/search?q={urllib.parse.quote(search_term)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Musicflow/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                found = json.loads(resp.read())
                text = (found[0].get("syncedLyrics") or found[0].get("plainLyrics")) if found else None
                return (text, None) if text else (None, None)
        except Exception as e:
            return None, str(e)

    raise ValueError(f"Unknown lyrics source: {method}")


def fetch_lyrics(artist: str | None, title: str, query: str, mp3_path: str) -> str | None:
    """Fetch lyrics from all 6 sources in LYRICS_SOURCE_ORDER — every source is tried, none are
    skipped after a first hit. The first hit in that priority order is returned as the main
    lyrics (same as before); every other hit is saved next to mp3_path as a backup file named
    {basename}.{method}.lrc, so the caller (or a future UI) can offer alternates to switch between."""
    search_term = f"{artist} {title}" if artist else query
    log.info("[lyrics] Searching: %s", search_term)

    results: list[tuple[str, str]] = []  # (method, lyrics_text), in priority order
    for method in LYRICS_SOURCE_ORDER:
        text, error = fetch_lyrics_from_source(method, artist, title, query)
        if text:
            is_synced = text.lstrip().startswith("[")
            log.info("[lyrics] ✓ Found via %s (%s) for: %s", method, "synced" if is_synced else "plain", search_term)
            results.append((method, text))
        elif error:
            log.warning("[lyrics] %s error for '%s': %s", method, search_term, error)
        else:
            log.info("[lyrics] %s returned nothing for: %s", method, search_term)

    if not results:
        log.info("[lyrics] ✗ No lyrics found for: %s", search_term)
        return None

    main_method, main_lyrics = results[0]
    for method, text in results[1:]:
        backup_path = mp3_path.rsplit(".", 1)[0] + f".{method}.lrc"
        try:
            with open(backup_path, "w", encoding="utf-8") as f:
                f.write(text)
            log.info("[lyrics] Saved backup (%s): %s", method, backup_path)
        except Exception as e:
            log.warning("[lyrics] Failed to save backup (%s) for %s: %s", method, mp3_path, e)

    return main_lyrics


def fetch_music_metadata(artist: str | None, title: str, query: str) -> dict | None:
    """Fetch music metadata from iTunes, falling back to Deezer."""
    search_term = f"{artist} {title}" if artist else query

    # Try iTunes first
    try:
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(search_term)}&media=music&entity=song&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "YTScraper/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get("resultCount", 0) > 0:
                r = data["results"][0]
                artwork_url = r.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                return {
                    "artist": r.get("artistName"),
                    "title": r.get("trackName"),
                    "album": r.get("collectionName"),
                    "genre": r.get("primaryGenreName"),
                    "year": r.get("releaseDate", "")[:4],
                    "track_number": r.get("trackNumber"),
                    "track_count": r.get("trackCount"),
                    "artwork_url": artwork_url,
                }
    except Exception:
        pass

    # Fallback: Deezer
    try:
        url = f"https://api.deezer.com/search?q={urllib.parse.quote(search_term)}&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "YTScraper/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get("data"):
                r = data["data"][0]
                return {
                    "artist": r.get("artist", {}).get("name"),
                    "title": r.get("title"),
                    "album": r.get("album", {}).get("title"),
                    "genre": None,
                    "year": None,
                    "track_number": None,
                    "track_count": None,
                    "artwork_url": r.get("album", {}).get("cover_xl") or r.get("album", {}).get("cover_big"),
                }
    except Exception:
        pass

    return None


def apply_metadata(mp3_path: str, metadata: dict | None, lyrics: str | None):
    """Apply music metadata, album art, and lyrics to MP3 via mutagen."""
    try:
        tags = ID3(mp3_path)
    except ID3NoHeaderError:
        audio = MP3(mp3_path)
        audio.add_tags()
        audio.save()
        tags = ID3(mp3_path)
    except Exception:
        return

    if metadata:
        if metadata.get("title"):
            tags.add(TIT2(encoding=3, text=metadata["title"]))
        if metadata.get("artist"):
            tags.add(TPE1(encoding=3, text=metadata["artist"]))
        if metadata.get("album"):
            tags.add(TALB(encoding=3, text=metadata["album"]))
        if metadata.get("genre"):
            tags.add(TCON(encoding=3, text=metadata["genre"]))
        if metadata.get("year"):
            tags.add(TDRC(encoding=3, text=metadata["year"]))
        if metadata.get("track_number"):
            trk = str(metadata["track_number"])
            if metadata.get("track_count"):
                trk += f"/{metadata['track_count']}"
            tags.add(TRCK(encoding=3, text=trk))
        if metadata.get("artwork_url"):
            try:
                req = urllib.request.Request(metadata["artwork_url"], headers={"User-Agent": "YTScraper/1.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=resp.read()))
            except Exception:
                pass

    if lyrics:
        tags.add(USLT(encoding=3, lang="eng", desc="", text=lyrics))

    tags.save()

    # Save .lrc sidecar file for synced lyrics (Android/portable player compatibility)
    if lyrics and lyrics.lstrip().startswith("["):
        lrc_path = mp3_path.rsplit(".", 1)[0] + ".lrc"
        try:
            with open(lrc_path, "w", encoding="utf-8") as f:
                f.write(lyrics)
        except Exception:
            pass


def download_mp3(url: str, output_dir: str, query: str, max_retries: int = 3) -> str | None:
    safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in query).strip()
    safe_name = re.sub(r'[\s_]*mp3$', '', safe_name, flags=re.IGNORECASE).strip()
    ffmpeg_path = find_ffmpeg()
    mp3_path = os.path.join(output_dir, f"{safe_name}.mp3")

    for attempt in range(1, max_retries + 1):
        ydl_opts = {
            "format": "bestaudio/best",
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                },
            ],
            "outtmpl": os.path.join(output_dir, f"{safe_name}.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            # Browser-like headers to avoid 403
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            "retries": 3,
            "fragment_retries": 3,
            "extractor_retries": 3,
            "sleep_interval": 1,
            "max_sleep_interval": 5,
        }
        if ffmpeg_path:
            ydl_opts["ffmpeg_location"] = ffmpeg_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
                return mp3_path
        except Exception as e:
            print(f"        [RETRY {attempt}/{max_retries}] {type(e).__name__}: {e}")
            if attempt < max_retries:
                wait = 5 * attempt + random.uniform(1, 3)
                print(f"        Waiting {wait:.0f}s before retry...")
                time.sleep(wait)

    return mp3_path if os.path.exists(mp3_path) else None


def generate_playlist(mp3_paths: list[str], playlist_name: str, output_dir: str) -> str:
    """Generate an M3U8 playlist file from a list of MP3 paths."""
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in playlist_name).strip()
    playlist_path = os.path.join(output_dir, f"{safe}.m3u8")
    with open(playlist_path, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for mp3_path in mp3_paths:
            artist, title = "Unknown", os.path.splitext(os.path.basename(mp3_path))[0]
            try:
                tags = ID3(mp3_path)
                if "TPE1" in tags:
                    artist = str(tags["TPE1"])
                if "TIT2" in tags:
                    title = str(tags["TIT2"])
            except Exception:
                pass
            f.write(f"#EXTINF:-1,{artist} - {title}\n")
            f.write(f"{os.path.basename(mp3_path)}\n")
    return playlist_path


def parse_playlist_input(lines: list[str]) -> tuple[list[str], dict[str, list[int]]]:
    """Parse input lines with optional --playlistadd/--playlistend markers.
    Returns (all_queries, playlists) where playlists maps name -> list of query indices."""
    queries = []
    query_index: dict[str, int] = {}  # dedup: query text -> index
    playlists: dict[str, list[int]] = {}
    current_playlist = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.lower().startswith("--playlistadd"):
            name = stripped[len("--playlistadd"):].strip()
            if name:
                current_playlist = name
                if name not in playlists:
                    playlists[name] = []
            continue
        if stripped.lower() == "--playlistend":
            current_playlist = None
            continue
        if stripped in query_index:
            idx = query_index[stripped]
        else:
            idx = len(queries)
            queries.append(stripped)
            query_index[stripped] = idx
        if current_playlist is not None:
            playlists[current_playlist].append(idx)

    return queries, playlists


def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else "queries.txt"
    output_dir = "downloads"
    os.makedirs(output_dir, exist_ok=True)

    try:
        with open(input_file, "r", encoding="utf-8") as f:
            queries = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found.")
        sys.exit(1)

    print(f"Processing {len(queries)} search queries...\n")

    results = []
    for i, query in enumerate(queries):
        result = get_first_video_link(query)
        if result:
            link, video_title, thumbnail_url = result
            print(f"[FOUND] {query}  ->  {link}")
            print(f"        Downloading MP3...")
            try:
                mp3 = download_mp3(link, output_dir, query)
            except Exception as e:
                mp3 = None
                print(f"[ERR]   {type(e).__name__}: {e}")
            if mp3:
                artist, song_title = parse_artist_title(video_title)
                metadata = fetch_music_metadata(artist, song_title, query)
                lyrics = fetch_lyrics(artist, song_title, query, mp3)
                if not metadata:
                    metadata = {}
                if not metadata.get("artwork_url") and thumbnail_url:
                    metadata["artwork_url"] = thumbnail_url
                apply_metadata(mp3, metadata, lyrics)
                if metadata:
                    print(f"[META]  {metadata.get('artist', '?')} - {metadata.get('title', '?')} ({metadata.get('album', '?')})")
                if lyrics:
                    print(f"[LYRICS] Embedded lyrics")
                results.append(f"{query}  ->  {link}  ->  {mp3}")
                print(f"[OK]    Saved to {mp3}")
            else:
                results.append(f"{query}  ->  {link}  ->  Download failed")
                print(f"[FAIL]  MP3 download failed")
        else:
            results.append(f"{query}  ->  No results found")
            print(f"[MISS]  {query}  ->  No results found")

        # Pause between queries to avoid rate-limiting
        if i < len(queries) - 1:
            delay = random.uniform(3, 7)
            print(f"        Waiting {delay:.0f}s before next query...")
            time.sleep(delay)

    # Write results to output file
    with open("results.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(results) + "\n")

    print(f"\nDone! Results saved to results.txt")
    print(f"MP3 files saved to {output_dir}/")


if __name__ == "__main__":
    main()
