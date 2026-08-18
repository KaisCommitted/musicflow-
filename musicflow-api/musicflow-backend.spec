# -*- mode: python ; coding: utf-8 -*-
# Freezes the Flask backend (electron_main.py) for the Electron shell to spawn as a child
# process. No pywebview/window code in this build — Electron owns the window.
#
# onedir (not onefile): a onefile build re-extracts itself into a temp dir on every launch,
# which is a real, noticeable startup delay for a desktop app people expect to open instantly.
# onedir starts near-instantly at the cost of shipping a folder instead of one exe — fine here
# since electron-builder bundles the whole folder as an extraResource either way.

from PyInstaller.utils.hooks import collect_data_files

a = Analysis(
    ['electron_main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('static', 'static'),
        ('bin/ffmpeg.exe', 'bin'),
        ('bin/ffprobe.exe', 'bin'),
        # yt-dlp needs a JS runtime to solve YouTube's JS challenge for its best audio formats —
        # without one, downloads 403 even though extraction/search still works fine. See
        # find_deno() in main.py.
        ('bin/deno.exe', 'bin'),
        # yt-dlp-ejs ships the actual challenge-solver JS as package data (.min.js files, not
        # .py) — PyInstaller's import tracing won't pick those up on its own. Bundling them
        # locally like this means yt-dlp never needs to fetch them from GitHub at runtime.
        *collect_data_files('yt_dlp_ejs'),
    ],
    # yt-dlp ships its own PyInstaller hook (via pyinstaller-hooks-contrib) that already pulls
    # in its extractor modules and transitive deps (requests, urllib3, Cryptodome, ...)
    # automatically — no manual collect_all needed here.
    hiddenimports=['syncedlyrics', 'pypresence'],
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
