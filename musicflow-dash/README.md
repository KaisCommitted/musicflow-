# Musicflow

**Build a React + TypeScript frontend for "Musicflow", a local music player with YouTube download capabilities. Use Vite as the build tool. The app is served by a Python/Flask backend — you only need to build the frontend.**

### Design System

- **Font:** `Cascadia Code`, fallback `Consolas`, `Courier New`, monospace — I love this font, keep it everywhere

- **Base theme:** Dark mode by default. Also support a light mode toggle in Settings

- **Accent color:** Orange `#ff7a1a` / `#ffb347` as the core brand color. Additionally, dynamically extract the dominant color from the currently playing song's album art and use it as a secondary accent (subtle glow behind the player, tinted progress bar, etc.). The orange remains the primary brand/UI color

- **Overall feel:** Modern, clean, premium. Think Spotify's layout density meets Apple Music's polish. Rounded corners, subtle shadows, smooth transitions

### Layout Structure

- **Sidebar (left, persistent):** Navigation links for: Library (default home), Download, History, Settings. Below the nav, show the last 5 distinct play contexts (could be a playlist name, "All Songs", an album name, or an artist name) as quick-resume shortcuts. The sidebar should be collapsible

- **Main content area (right):** Changes based on sidebar selection

- **Bottom player bar (persistent):** Always visible when a song is loaded. Shows: album art thumbnail, song title, artist, play/pause, previous, next, shuffle, repeat (one/all), waveform-style seekable progress bar (make the waveform visually appealing with the accent color filling as it progresses), volume slider, a lyrics toggle button, and a queue toggle button

- **Queue panel:** A collapsible/expandable slide-out panel (right side) showing the current queue. Songs can be drag-and-dropped to reorder. Shows what's playing now and what's coming next

### Full-Screen Player

- Clicking the album art in the bottom bar opens a full-screen player view

- Background: the album art, heavily blurred and darkened, edge-to-edge

- Center: large album art with subtle shadow

- Below art: song title, artist, progress bar, playback controls

- Animated synced lyrics overlaid (scroll smoothly, highlight current line, dim past lines)

- This view persists across song changes — when the next song plays, it transitions smoothly to the new song's art/lyrics

- A back/minimize button returns to the normal view

### Library View (Home)

This is the main view and the heart of the app. Sub-navigation for:

**All Songs:** A scrollable list/table of every song in the music folder. Columns: #, Title, Artist, Album, Duration. Sortable. Clicking a song plays it and queues the full song list. Show playlist tag badges under each song title (e.g., colored pills like "Car", "Shower", "Workout") for every playlist that song belongs to.

**Albums:** A grid of album cards (album art + album name + artist). Auto-grouped from MP3 file metadata (ID3 tags). Clicking an album shows its songs.

**Artists:** A list/grid of artists. Auto-grouped from ID3 metadata. Clicking an artist shows their songs/albums.

**Playlists:** Shows all playlists (read from `.m3u8` files in the music folder). Clicking a playlist shows its songs. User can:

- Create new playlists

- Add/remove songs from playlists via right-click context menu or drag-and-drop

- Select multiple playlists and play them combined as one queue

- Playlist tags appear on songs in every view (All Songs, Albums, etc.)

### Context Menu (Right-Click on any song)

- Play Now

- Play Next (insert into queue after current)

- Add to Queue (append to end)

- Add to Playlist → (submenu showing all playlists + "Create New")

- Remove from Playlist (if viewing a playlist)

- Go to Album

- Go to Artist

### Download View

- Text area to paste song queries (one per line), supports the `--playlistadd` / `--playlistend` syntax for auto-creating playlists

- Start Download button, with real-time progress cards showing: song name, status badge (pending/searching/downloading/done/skipped/error), progress bar with percentage

- Stats bar: total, done, skipped, errors, active

- Pause/Resume/Stop/Retry controls

- When a download finishes, user can play it immediately from the result card

### History View

- List of past download jobs (date, total, done, errors)

- Expandable detail: see individual songs, filter by status, paginated

- Retry failed songs individually

- Click error badges to copy error text

### Settings View

- **Music Folder:** path selector (the folder that the library reads from)

- **Download Folder:** path selector (where YouTube downloads go — can be the same as music folder)

- **Theme:** Light / Dark mode toggle

- **Any other settings** you think a music player should have

### Global Search

- A search bar at the top of the main content area

- Searches across songs, albums, artists, and playlists in the local library

- Show results grouped by category

### Technical Requirements

- React 18+ with TypeScript

- Vite for bundling

- Use React Router for navigation (sidebar links = routes)

- State management: Zustand or React Context — your choice

- All API calls should go through a centralized `api.ts` service file with typed request/response interfaces

- Use a single global `AudioContext`/`Audio` element managed by a player store

- Use `react-beautiful-dnd` or similar for drag-and-drop in queue and playlists

- Responsive but desktop-first (minimum 1024px width)

- Smooth animations and transitions everywhere (framer-motion encouraged)

### API Endpoints (already implemented in backend)

The backend provides these endpoints — use them as-is:

**Downloads:**

- `POST /api/start` — body: `{ queries: string[] }` → `{ job_id }`

- `GET /api/status/{job_id}` → `{ total, done, skipped, errors, cancelled, active, pending, finished, paused, recent[] }`

- `POST /api/stop/{job_id}`, `POST /api/pause/{job_id}`, `POST /api/resume/{job_id}`, `POST /api/retry/{job_id}`

- `GET /api/stream/{job_id}/{index}` — streams MP3 audio

- `GET /api/artwork/{job_id}/{index}` — returns album art image

- `GET /api/lyrics/{job_id}/{index}` → `{ lyrics: string | null }`

**History:**

- `GET /api/history` → `{ jobs[] }` (summary)

- `GET /api/history/{id}?page=&per_page=&status=` → paginated detail

- `POST /api/history/retry` — body: `{ history_id, query }`

**Playlists & Scanning:**

- `POST /api/scan` — body: `{ folder }` → `{ songs[] }`

- `POST /api/playlists` — body: `{ folder, lines[] }` → `{ playlists[] }`

- `POST /api/browse` → `{ folder }` (opens native folder picker)

**Lyrics generation:**

- `POST /api/generate-lyrics` — body: `{ folder }` → `{ job_id }`

- `GET /api/generate-lyrics/status/{job_id}` → progress

**Note:** Some endpoints for the new library features (local file browsing, streaming local files by path, reading metadata for all songs) don't exist yet. For those, create the API service functions with clear interfaces and TODO comments — I'll implement the backend endpoints to match.

### What NOT to include

- No authentication/login

- No backend code

- No database — the backend handles all persistence

- No Electron/Tauri shell — this runs in a browser served by Flask

## Development

```sh
npm i
npm run dev
```
