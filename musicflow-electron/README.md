# musicflow-electron

The desktop shell. Spawns the Python backend (from source in dev, or the PyInstaller-frozen
`musicflow-backend.exe` once packaged) as a child process on a port it picks itself, waits for
`/api/health`, then opens a window pointed at it. Replaces the old pywebview-based `app.py`.

## Dev

```
cd musicflow-electron
npm install
npm start
```

Requires `musicflow-api/static/` to already have a built frontend (`cd musicflow-dash && npm
run build`) and `py` on PATH — `main.js` runs `py electron_main.py` straight from source in dev,
no PyInstaller round trip needed while iterating.

**If `npm start` crashes with `Cannot read properties of undefined (reading
'requestSingleInstanceLock')`**: your terminal inherited `ELECTRON_RUN_AS_NODE=1` from a parent
process — VS Code's integrated terminal does this for its own extension host. Electron respects
that var and runs as plain Node instead of launching the app. Fix: `$env:ELECTRON_RUN_AS_NODE =
$null` (PowerShell) before running, or use a terminal outside VS Code.

## Building the installer locally

```
npm run dist
```

Runs PyInstaller (via `build:backend`) then `electron-builder --win`, producing
`release/Musicflow Setup <version>.exe` — an NSIS installer, per-user install (no admin/UAC),
unsigned (expect a Windows SmartScreen "unknown publisher" prompt the first run).

`musicflow-api/bin/ffmpeg.exe`, `ffprobe.exe`, and `deno.exe` must exist before building —
they're gitignored (binary, not something to commit) and bundled by `musicflow-backend.spec`.
Place your own copies there, or see `.github/workflows/release.yml` for where CI fetches them
from.

On macOS, `npm run dist:mac` does the equivalent (`build:backend:mac`, which uses `python3`,
then `electron-builder --mac`), producing a `.dmg`/`.zip` under `release/` for whichever arch
you're building on. Same deal, no `.exe` suffix: `musicflow-api/bin/ffmpeg`, `ffprobe`, `deno`,
and `node` must exist first, and `build/icon.icns` / `build/icon.png` must exist too (CI
generates both from `musicflow-dash/public/brand/musicflow-mark-transparent.svg` — see the
"Generate mac app icon" step in `.github/workflows/release.yml` for the exact commands if
building locally). Also unsigned — macOS Gatekeeper blocks the first launch, worked around with
right-click → Open instead of double-clicking.

## Releasing

Push a tag matching `v*.*.*` (or run the "Release" workflow manually from the Actions tab) — CI
builds the Windows and macOS (x64 + arm64) installers and publishes all of them to GitHub
Releases. The package version comes from the tag, not `package.json`.

## Update checks

On launch (packaged builds only — see `updater.js`), Musicflow checks GitHub Releases for a
newer version:

- **Windows**: real auto-update via `electron-updater`. It downloads the new version in the
  background and, once ready, asks to restart and install now or wait until next quit. Works
  unsigned — NSIS auto-update doesn't require a code-signing cert.
- **macOS**: notice only. A dialog says a new version is available and offers to open the
  GitHub release page; the user downloads and runs it manually, same as today. Real auto-update
  (Squirrel.Mac) requires the app be code-signed and notarized, which it currently isn't — so
  this is the ceiling without paying for an Apple Developer cert.
