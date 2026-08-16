# 🎵 Musicflow

Bulk download music from YouTube with metadata, artwork, and synced lyrics — all from a clean local web UI.

![Python](https://img.shields.io/badge/Python-3.12+-blue)
![Flask](https://img.shields.io/badge/Flask-web_ui-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Download

**[⬇ Download Musicflow Installer (Windows)](https://github.com/KaisCommitted/Musicflow/releases/latest)**

Run the installer → launch from Start Menu or Desktop. That's it.

## Features

- **Bulk download** — paste a list of songs and download them all at once
- **Parallel workers** — 3 concurrent downloads for speed
- **Auto metadata** — fetches artist, album, year, genre, and artwork automatically
- **Synced lyrics** — embeds time-synced `.lrc` lyrics from multiple providers (Lrclib, NetEase, Megalobiz)
- **Mini player** — built-in audio player with waveform visualization and live lyric sync
- **Generate lyrics** — scan an existing music folder and backfill lyrics for all your MP3s
- **History & retry** — track past downloads, retry failures with one click
- **Playlist detection** — auto-groups downloads into playlists
- **Desktop app** — runs as a native window via pywebview, no browser needed
- **Docker support** — also runs in Docker with hot reload for development

## Screenshots

<!-- Add screenshots here -->

## Quick Start (from source)

```bash
git clone https://github.com/KaisCommitted/Musicflow.git
cd Musicflow
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

You'll also need `ffmpeg` — place `ffmpeg.exe` in a `bin/` folder or have it on your PATH.

```bash
python app.py
```

## Docker

```bash
docker compose up --build
```

Open `http://localhost:5000`. Downloads go to a Docker volume.

## How It Works

1. Enter song names (one per line) and pick a download folder
2. Musicflow searches YouTube, downloads the best audio match, and converts to MP3
3. Metadata (title, artist, album, artwork) is fetched and embedded automatically
4. Synced lyrics are searched across multiple providers and embedded as ID3 tags + `.lrc` files
5. Play tracks directly in the built-in mini player with live lyric display

## Tech Stack

| Component | Purpose |
|-----------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube search & audio download |
| [ffmpeg](https://ffmpeg.org/) | Audio extraction & conversion |
| [mutagen](https://mutagen.readthedocs.io/) | MP3 ID3 tag manipulation |
| [syncedlyrics](https://github.com/rtcq/syncedlyrics) | Multi-provider lyrics search |
| [Flask](https://flask.palletsprojects.com/) | Web server & API |
| [pywebview](https://pywebview.flowrl.com/) | Native desktop window |

## Building

### Exe (PyInstaller)

```bash
python -m PyInstaller Musicflow.spec --noconfirm
```

Output: `dist/Musicflow.exe`

### Installer (Inno Setup)

```bash
ISCC.exe installer.iss
```

Output: `installer_output/MusicflowSetup-1.0.0.exe`

---

Built by [@KaisCommitted](https://github.com/KaisCommitted)
