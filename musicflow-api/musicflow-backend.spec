# -*- mode: python ; coding: utf-8 -*-
# Freezes the Flask backend (electron_main.py) for the Electron shell to spawn as a child
# process. No pywebview/window code in this build — Electron owns the window.
#
# onedir (not onefile): a onefile build re-extracts itself into a temp dir on every launch,
# which is a real, noticeable startup delay for a desktop app people expect to open instantly.
# onedir starts near-instantly at the cost of shipping a folder instead of one exe — fine here
# since electron-builder bundles the whole folder as an extraResource either way.

import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# Bundled binaries ship with a .exe suffix on Windows and no suffix on macOS/Linux — mirrors
# _EXE_SUFFIX in main.py's find_ffmpeg()/find_deno()/find_node(), which is what actually loads
# these at runtime.
_exe = ".exe" if sys.platform == "win32" else ""

a = Analysis(
    ['electron_main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('static', 'static'),
        (f'bin/ffmpeg{_exe}', 'bin'),
        (f'bin/ffprobe{_exe}', 'bin'),
        # yt-dlp needs a JS runtime to solve YouTube's JS challenge for its best audio formats —
        # without one, downloads 403 even though extraction/search still works fine. See
        # find_deno() in main.py.
        (f'bin/deno{_exe}', 'bin'),
        # yt-dlp-ejs ships the actual challenge-solver JS as package data (.min.js files, not
        # .py) — PyInstaller's import tracing won't pick those up on its own. Bundling them
        # locally like this means yt-dlp never needs to fetch them from GitHub at runtime.
        *collect_data_files('yt_dlp_ejs'),
        # PO token provider for anonymous downloads — see find_node()/find_pot_server() in
        # main.py for why this matters (yt-dlp's default client fallback 403s even when a
        # login is never involved; a PO token fixes what cookies fix for a different reason).
        # node is a standalone binary (verified: no other DLLs needed alongside it on Windows;
        # same assumption carried over for mac), same bundling shape as ffmpeg/deno.
        # bgutil-server/ is bgutil-ytdlp-pot-provider's server component pre-built once (npm ci
        # && npx tsc, pruned to production deps only — see .github/workflows/release.yml)
        # rather than built on every CI run or on the end user's machine, neither of which
        # should need a Node/npm toolchain just to run this.
        (f'bin/node{_exe}', 'bin'),
        ('bin/bgutil-server', 'bin/bgutil-server'),
    ],
    # yt-dlp ships its own PyInstaller hook (via pyinstaller-hooks-contrib) that already pulls
    # in its extractor modules and transitive deps (requests, urllib3, Cryptodome, ...)
    # automatically — no manual collect_all needed here.
    #
    # bgutil-ytdlp-pot-provider is different: it's a yt-dlp *plugin*, discovered at runtime by
    # scanning the yt_dlp_plugins namespace package rather than being imported anywhere in
    # traced code — PyInstaller's static analysis has nothing to follow to find it (the same
    # reason yt_dlp_ejs needs collect_data_files above, just for .py modules instead of data).
    hiddenimports=['syncedlyrics', 'pypresence', *collect_submodules('yt_dlp_plugins')],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='musicflow-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX-compressed executables are a well-documented trigger for antivirus false positives
    # (packing is also how a lot of actual malware evades signature detection, so heuristics
    # are trigger-happy about it) — not worth it for an unsigned installer that's already
    # asking users to trust an "unknown publisher" SmartScreen prompt.
    upx=False,
    # False: this process is spawned hidden by Electron, which pipes its stdout/stderr for
    # logging — a console=True build would flash a visible terminal window on every launch.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    # UPX-compressed executables are a well-documented trigger for antivirus false positives
    # (packing is also how a lot of actual malware evades signature detection, so heuristics
    # are trigger-happy about it) — not worth it for an unsigned installer that's already
    # asking users to trust an "unknown publisher" SmartScreen prompt.
    upx=False,
    upx_exclude=[],
    name='musicflow-backend',
)
