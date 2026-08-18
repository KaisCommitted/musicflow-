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

## Releasing

Push a tag matching `v*.*.*` (or run the "Release" workflow manually from the Actions tab) — CI
builds the installer and publishes it to GitHub Releases. The package version comes from the tag,
not `package.json`. In-app auto-update isn't wired up (electron-builder's publish step still
produces the manifest for it, so adding that later doesn't require repackaging anything).
