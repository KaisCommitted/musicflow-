import glob
import json
import logging
import os
import re
import shutil
import sys
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


def find_deno() -> str | None:
    """A JS runtime yt-dlp needs to solve YouTube's JS challenge for its best audio formats —
    without one, requests for those formats (what we ask for) 403, even though yt-dlp can often
    still fall back to older, lower-quality formats that aren't gated the same way. Optional:
    if not found, downloads just proceed without js_runtimes set (yt-dlp's own degraded-but-
    working fallback), same best-effort spirit as everything else here."""
    if getattr(sys, "frozen", False):
        bundled = os.path.join(sys._MEIPASS, "bin", "deno.exe")
        if os.path.isfile(bundled):
            return bundled
    else:
        dev_bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "deno.exe")
        if os.path.isfile(dev_bundled):
            return dev_bundled
    return shutil.which("deno")


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
#
# Musixmatch was tried as a 4th source here but was dropped: its unofficial desktop-app API
# issues a guest token fine, then 401s every request after it — consistently, across unrelated
# queries, while the exact same request succeeds from a different network. That pattern points
# to them throttling/blocking by IP rather than a bug in our request, and it's not worth
# hammering their private endpoint for a source that just doesn't come back for us.
#
# Megalobiz was dropped too: www.megalobiz.com consistently connect-times-out at 2s, reproduced
# from two different networks — the host itself looks unreachable/overloaded, not something
# fixable on our end.
#
# lyrics-ovh and genius added as broader-coverage fallbacks (both plain/unsynced text, no API
# key). lyrics-ovh sits ahead of genius since it's a clean direct lookup; genius is scraped from
# genius.com's lyrics page and needs _clean_genius_text() to strip page boilerplate (contributor
# count, translation links, page title, an optional annotation blurb) that gets scraped in ahead
# of the actual lyrics — more fragile to Genius changing their page markup, so it's last.
LYRICS_SOURCE_ORDER = ["lrclib", "netease", "lrclib-exact", "lrclib-search", "lyrics-ovh", "genius"]

# Matches everything from the start of a scraped Genius result through the "{Title} Lyrics"
# page heading, plus an optional annotation blurb ending in "Read More" right after it — see
# LYRICS_SOURCE_ORDER comment above for why this is needed.
_GENIUS_BOILERPLATE_RE = re.compile(r"^.*?\bLyrics\n+(?:.*?Read More\n+)?", re.DOTALL)


def _clean_genius_text(text: str) -> str:
    m = _GENIUS_BOILERPLATE_RE.match(text)
    return text[m.end():].strip() if m else text.strip()


def fetch_lyrics_from_source(method: str, artist: str | None, title: str, query: str) -> tuple[str | None, str | None]:
    """Try exactly one lyrics source (no file writes). Returns (lyrics_text, error):
    - (text, None): found
    - (None, None): legitimate miss — the source has nothing for this song
    - (None, error): the request itself failed (timeout, connection error, etc.)"""
    from syncedlyrics.providers import Lrclib, NetEase, Genius
    from syncedlyrics.utils import TargetType

    # Suppress noisy syncedlyrics internal logging
    logging.getLogger("syncedlyrics").setLevel(logging.WARNING)

    search_term = f"{artist} {title}" if artist else query

    if method in ("lrclib", "netease", "genius"):
        provider = {"lrclib": Lrclib, "netease": NetEase, "genius": Genius}[method]()
        try:
            lrc = provider.get_lrc(search_term)
            text = lrc.to_str(TargetType.PREFER_SYNCED) if lrc else None
            if method == "genius" and text:
                text = _clean_genius_text(text)
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

    if method == "lyrics-ovh":
        if not artist:
            return None, None
        try:
            url = f"https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}/{urllib.parse.quote(title)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Musicflow/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                text = data.get("lyrics")
                return (text, None) if text else (None, None)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, None
            return None, str(e)
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

