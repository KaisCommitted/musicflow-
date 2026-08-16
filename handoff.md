# Musicflow — Session Handoff

You're continuing work on **Musicflow**, a local desktop music player with YouTube download capabilities. You have full codebase access — read the files directly rather than relying on this summary for implementation details. This document tells you what exists, what's working, what's broken, and what to build next.

## Project Structure

```
musicflow/
├── musicflow-api/     ← Python Flask backend (the "server")
│   ├── server.py      ← All API endpoints
│   ├── main.py        ← Core logic: yt-dlp downloads, lyrics fetching, metadata, playlist generation
│   ├── db.py          ← SQLite at %APPDATA%/Musicflow/data.db
│   ├── app.py          ← Desktop entry: pywebview + Flask in a thread
│   └── static/        ← Production React build output
├── musicflow-dash/    ← React frontend (Vite + TanStack Router + Zustand + Tailwind 4)
│   ├── src/routes/    ← Pages: index (library), download, lyrics, settings
│   ├── src/store/     ← State: player.ts, library.ts, download.ts, lyricsGen.ts, view.ts, menu.ts
│   ├── src/lib/api.ts ← Every backend call lives here
│   └── vite.config.ts ← Builds to ../musicflow-api/static/, dev proxy /api→:5000
```

Both halves now live in **one repo** (this one) instead of two separate ones — no more juggling `musicflow-api`/`musicflow-dash` as independent git projects.

## How to Run

- Use `py` not `python` (the machine has Python 3.13 via the py launcher)
- Backend: `cd musicflow-api && py server.py` → Flask on :5000
- Frontend dev: `cd musicflow-dash && npm run dev` → Vite on :5173 (proxies /api)
- Build for production: `cd musicflow-dash && npm run build` → writes to `musicflow-api/static/`

## What Works

- Full library scanning with ID3 metadata cache in SQLite (only re-reads changed files)
- Music playback: HTML5 Audio, queue, shuffle, repeat, volume, waveform seeker, full-screen player with synced lyrics
- YouTube downloads with retry-until-done logic (cycles failed songs, 2.5s throttle, 10s pause/10 songs, timeout = 10s × song count)
- Download page: shows progress, hides errors during retries, play button on completed songs; History lives inside it as a second tab (it's specifically *download* history)
- **Lyrics fetching tries 5 sources every time, not just until the first hit:** syncedlyrics' Lrclib/NetEase/Megalobiz providers, then direct LRCLIB exact-match and fuzzy-search — see `fetch_lyrics()` in `main.py`. The first hit in that priority order is embedded as the song's main lyrics (USLT tag + `.lrc` sidecar), exactly as before. Every *other* source that also hit gets saved as a backup file: `{basename}.{method}.lrc` (e.g. `song.netease.lrc`). Nothing plays these back yet — they're there so a future "switch lyrics like subtitles" UI has candidates to offer. Backups are correctly renamed alongside the main file when the download flow corrects a filename post-metadata (`rename_lyrics_backups()` in `main.py`).
- **Bulk lyrics generation now has a UI** — its own "Lyrics" nav section (`/lyrics`), replacing the old History nav slot. Button triggers `POST /api/generate-lyrics` for the configured music folder, polls `GET /api/generate-lyrics/status/{job_id}`, shows a paginated per-file progress list. Job state is sessionStorage-persisted (`store/lyricsGen.ts`) and resumes polling if you navigate away and back, same pattern as downloads.
- **Single music folder, no separate "download folder" setting.** Downloads always save into the same folder the library scans. Backend resolves it dynamically via `music_folder()` in `server.py` (reads the `musicFolder` setting live) instead of the old fixed `DOWNLOAD_DIR` constant — which, worth knowing, was never actually wired to the old "download folder" setting in the first place; it silently always pointed at `~/Downloads/Musicflow` regardless of what the UI said.
- **App is gated behind a valid music folder.** `AppShell` blocks the entire UI (sidebar, player, everything) behind a full-screen prompt (`FolderSetupGate`) until a folder is configured and actually scans successfully — covers both "never configured" (first launch) and "configured but now missing" (moved/renamed/unplugged drive), and re-triggers any time a later scan fails, not just at startup. Replaced the old silent "demo library" fallback, which used to paper over a broken folder with fake placeholder songs.
- History in SQLite, settings in SQLite (`GET/POST /api/settings`)
- Dark/light theme, dynamic accent color from album art, keyboard shortcuts
- Frontend is a plain Vite SPA (TanStack Router, client-side only) — the old TanStack Start/SSR/Lovable scaffold (nitro, `server.ts`/`start.ts`, `@lovable.dev/vite-tanstack-config`) has been fully removed along with ~35 unused shadcn/ui components that were never referenced anywhere.

## What's Broken / Needs Attention

- `store/download.ts` passes an `onRehydrate` option to zustand's `persist()` — that's not a real option (should be `onRehydrateStorage`), so it's silently a no-op and doesn't actually do anything on rehydration. It's harmless only because `download.tsx`'s route already calls `_resumeIfNeeded()` itself in a `useEffect` on mount, which is the thing that actually restores in-flight polling. Worth fixing or removing so it's not misleading.
- Artwork URLs returned by `/api/scan`/`/api/library` are now `urllib.parse.quote()`-encoded (fixed a real bug: any song with `&`, `#`, `%`, etc. in its filename — e.g. "Bob Marley & The Wailers" — had its thumbnail silently fail to load because the raw `&` broke the query string). If you ever build another endpoint that embeds a filename into a URL server-side, encode it.
- No other known critical bugs. The download system works end-to-end including retry cycles, count accuracy, and state recovery on refresh.

## What to Build Next

### Playlist System (partially exists, needs wiring)

The download textarea in the old app supported `--playlistadd Name` / `--playlistend` syntax to auto-create playlists from downloads. The backend parser (`parse_playlist_input()` in main.py) and `.m3u8` generator (`generate_playlist()`) both work. `POST /api/playlists` with non-empty `lines` triggers it.

The frontend currently:
- Reads playlists from `.m3u8` files via `getPlaylists(folder)`
- Has `addPlaylist`/`removeSongFromPlaylist` in the library store but they only update local state (not persisted)
- Has CRUD endpoints available: `POST /api/playlist/create`, `/update`, `/delete`
- Has SQLite tables (`playlists`, `playlist_songs`) in db.py but they're unused

**Decision needed:** either use `.m3u8` files as source of truth (current) or migrate to SQLite tables. The `.m3u8` approach has the advantage of portability (other players can read them).

### Lyrics switcher ("swap subtitles")

The backup lyrics files described above (`{basename}.{method}.lrc`) exist purely as fetch-and-save right now — nothing reads them back. Next step would be a UI (probably in the full-screen player, near where lyrics render) to list the available candidate files for the currently-playing song and let the user pick which one becomes the active lyrics. `GET /api/local-lyrics?path=` currently only ever looks at the USLT tag or the single plain `.lrc` sidecar — it'll need to grow an endpoint (or a parameter) to list/select from the `.{method}.lrc` backups too.

## Critical Implementation Details

- **`finished` flag:** Must be explicitly `job["finished"] = True` — never compute it from item statuses (retry cycles create moments where all items are "error" with no active/pending, which looks "finished" but isn't)
- **Download item visibility:** `server.py` filters the status response: hides `pending`, `searching`, `error` (unless finished), `cancelled` (unless finished), and `downloading` with `progress < 1%`
- **Player URL routing:** In `player.ts`, the `load()` function uses the path directly if it starts with `/api/` (download streams via `/api/stream/{jobId}/{idx}`), otherwise wraps it in `/api/file?path=...` (library files by absolute path)
- **Retry resets `finished`:** The `/api/retry/{job_id}` endpoint sets `job["finished"] = False` before spawning the new thread
- **Items sorted by completion time:** The status response sorts items with downloading first, then by `completed_at` timestamp (newest completed first)
- **ANSI stripping:** Error strings from yt-dlp are cleaned with `re.sub(r'\x1b\[[0-9;]*m', '', str(exc))`
- **Download store persistence:** Uses `zustand/middleware/persist` with `sessionStorage` — survives refresh, clears on tab close. `_resumeIfNeeded()` restarts polling on mount if job isn't finished. Same pattern for `store/lyricsGen.ts`.
- **No cookie auth for yt-dlp:** Brave locks its DB while open. 403s are handled by retry cycles instead.
- **Music folder is required app-wide:** every job-creation endpoint (`/api/start`, the fresh-job branch of `/api/history/retry`) calls `music_folder()` and 400s with `"No music folder configured"` if it's unset or missing on disk — don't reintroduce a fixed fallback path.
