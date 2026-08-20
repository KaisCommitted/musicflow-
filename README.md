# 🎵 Musicflow

A local desktop music player: bulk-download music from YouTube with metadata, artwork, and
synced lyrics, then manage and play your whole library from a clean, fast desktop app.

![Python](https://img.shields.io/badge/Python-3.12+-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![Electron](https://img.shields.io/badge/Electron-desktop_app-47848f)

## Download

**[⬇ Download Musicflow for Windows](https://github.com/KaisCommitted/musicflow-/releases/latest/download/Musicflow-Setup.exe)**

Run the installer, then launch Musicflow from the Start Menu or Desktop. That's it — no Python,
no Node, nothing else to install. This link always grabs the latest version — no need to pick
anything on the [releases page](https://github.com/KaisCommitted/musicflow-/releases/latest).

On Mac, grab the `.dmg` for your chip (Apple Silicon or Intel) from the
[releases page](https://github.com/KaisCommitted/musicflow-/releases/latest) instead.

## Features

**Library & playback**
- Fast local library scan with a metadata cache — only re-reads files that actually changed
- Browse by All Songs, Albums, Artists, Genres, or Playlists; virtualized so it stays smooth
  past 900+ tracks
- Queue with shuffle, repeat, gapless playback, and adjustable crossfade
- Multi-select + bulk actions (add to playlist, remove, etc.) in the song table
- Full-screen "Now Playing" view with a live audio visualizer and animated synced lyrics —
  scrolling or a large prev/current/next view, your choice
- Like a song to add it straight to a Favorites playlist
- Sleep timer

**Downloads & lyrics**
- Paste a list of songs and bulk-download them, three at a time
- Metadata (artist, album, year, genre, artwork) fetched and embedded automatically
- Synced lyrics pulled from multiple providers every time (not just until the first hit) and
  embedded as ID3 tags + `.lrc` files
- Bulk-generate lyrics for an existing library you didn't download through Musicflow
- Auto-detects and creates playlists from your download list

**Customization**
- Dark/light theme, with a secondary accent color drawn live from whatever album art is playing
- Remappable keybinds, with an optional system-wide mode so playback keys work even when
  Musicflow isn't focused
- Backup/export your playlists and settings to a single file

**Desktop integration**
- Runs as a real desktop app via Electron — frameless window, native install/uninstall
- Minimizes to the system tray — closing the window keeps music playing in the background;
  quit from the tray icon's menu when you actually want to exit
- Discord Rich Presence (shows what you're listening to — nothing to configure)
- Scrobbling to ListenBrainz and/or Last.fm

## Project Structure

```
musicflow-api/       Python/Flask backend — library scanning, downloads, lyrics, SQLite storage
musicflow-dash/       React frontend (Vite + TanStack Router + Zustand + Tailwind)
musicflow-electron/   Desktop shell — spawns the backend, opens the window, builds the installer
```

Each has its own `npm start`/`py server.py` for local dev; see **[musicflow-electron/README.md](musicflow-electron/README.md)**
for the full desktop build/release flow.

## Quick Start (from source)

```bash
git clone https://github.com/KaisCommitted/musicflow-.git
cd musicflow-/musicflow-api
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

You'll also need `ffmpeg` — place `ffmpeg.exe`/`ffprobe.exe` in a `bin/` folder here, or have
them on your PATH. [Deno](https://deno.com/) is optional but recommended — yt-dlp uses it to
solve YouTube's JS challenge for the best-quality audio formats; without it, some downloads
fail with a 403 that a JS runtime would have avoided. Same `bin/` folder, or your PATH.

```bash
py server.py
```

Open `http://localhost:5000` — the pre-built frontend is served from `static/`. To run the
frontend in dev mode instead (hot reload):

```bash
cd musicflow-dash
npm install
npm run dev
```

Or as a native window instead of a browser tab — see `musicflow-electron/README.md`.

## Docker

```bash
cd musicflow-api
docker compose up --build
```

Open `http://localhost:5000`. Downloads go to a Docker volume.

## How It Works

1. Enter song names (one per line) and start the download
2. Musicflow searches YouTube, downloads the best audio match, and converts it to MP3
3. Metadata (title, artist, album, artwork) is fetched and embedded automatically
4. Synced lyrics are searched across multiple providers and embedded as ID3 tags + `.lrc` files
5. Everything lands in your library, ready to browse and play

## Tech Stack

| Component | Purpose |
|-----------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube search & audio download |
| [ffmpeg](https://ffmpeg.org/) | Audio extraction & conversion |
| [Deno](https://deno.com/) | JS runtime yt-dlp uses to solve YouTube's challenge |
| [mutagen](https://mutagen.readthedocs.io/) | MP3 ID3 tag manipulation |
| [syncedlyrics](https://github.com/rtcq/syncedlyrics) | Multi-provider lyrics search |
| [Flask](https://flask.palletsprojects.com/) | Backend web server & API |
| [React](https://react.dev/) + [Vite](https://vite.dev/) | Frontend |
| [TanStack Router](https://tanstack.com/router) + [Zustand](https://zustand-demo.pmnd.rs/) | Routing & state |
| [Electron](https://www.electronjs.org/) | Native desktop shell & installer |
| [pypresence](https://github.com/qwertyquerty/pypresence) | Discord Rich Presence |

## Building the Installer

See **[musicflow-electron/README.md](musicflow-electron/README.md)** for the full build/release
flow. Short version:

```bash
cd musicflow-electron
npm run dist
```

Freezes the backend with PyInstaller, then packages it with Electron into an NSIS installer at
`musicflow-electron/release/Musicflow Setup <version>.exe`.

---

Built by [@KaisCommitted](https://github.com/KaisCommitted)
