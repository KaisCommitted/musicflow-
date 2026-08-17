# -*- mode: python ; coding: utf-8 -*-
# Freezes the Flask backend (electron_main.py) for the Electron shell to spawn as a child
# process. No pywebview/window code in this build — Electron owns the window.
#
# onedir (not onefile): a onefile build re-extracts itself into a temp dir on every launch,
# which is a real, noticeable startup delay for a desktop app people expect to open instantly.
# onedir starts near-instantly at the cost of shipping a folder instead of one exe — fine here
# since electron-builder bundles the whole folder as an extraResource either way.

a = Analysis(
    ['electron_main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('static', 'static'),
        ('bin/ffmpeg.exe', 'bin'),
        ('bin/ffprobe.exe', 'bin'),
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
    upx=True,
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
    upx=True,
    upx_exclude=[],
    name='musicflow-backend',
)
