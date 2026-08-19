const { app, BrowserWindow, Tray, Menu, dialog, shell, globalShortcut, ipcMain } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

// Electron derives app.getPath("userData") from the app name, which in dev mode falls back to
// package.json's "name" ("musicflow-electron") rather than "productName" — pinning it here
// keeps the log file at %APPDATA%/Musicflow in both dev and the packaged build, matching where
// the Python backend already keeps its own db/log (see musicflow-api/db.py).
app.setName("Musicflow");

// Frameless windows (frame: false + backgroundColor below, since TitleBar.tsx draws our own
// chrome) are the textbook trigger for a well-documented Electron/Chromium bug: on some
// machines (Intel integrated graphics, remote desktop sessions, VMs, or after a GPU driver
// hiccup) the GPU compositor fails silently and the window paints solid black forever — not
// even the hand-drawn titlebar shows, since there's no native chrome to fall back to. Must be
// called before app.whenReady(). Costs a little smoothness on the blur/visualizer effects, but
// a window that reliably shows something beats one that sometimes doesn't.
app.disableHardwareAcceleration();

let backendProcess = null;
let mainWindow = null;
let backendPort = null;
let tray = null;
// Set once a real quit is underway (tray "Quit", OS shutdown, ...) so the window's own
// close handler knows to actually let it close instead of hiding to the tray.
let isQuitting = false;

/** Let the OS pick a free port instead of hardcoding one — avoids ever colliding with a
 * `py server.py` dev instance someone already has running on 5000. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** `build/` is only packaged as far as electron-builder's own `win.icon`/`mac.icon` (it bakes
 * the icon into the compiled binary's resources at build time) — it was never actually
 * included in the app bundle for main.js to read at runtime, so this path resolved to a file
 * that didn't exist inside app.asar. BrowserWindow's `icon` option failed silently on that;
 * `new Tray()` does not — it throws, which is what actually surfaced this. Fixed by shipping
 * the icon as a real extraResource (see package.json) instead of reading it from inside the
 * asar. macOS has no .ico support, hence the separate .png (see build/ generation in
 * .github/workflows/release.yml). */
function iconPath() {
  const name = process.platform === "win32" ? "icon.ico" : "icon.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, "build", name);
}

function backendCommand() {
  if (app.isPackaged) {
    const name = process.platform === "win32" ? "musicflow-backend.exe" : "musicflow-backend";
    const exe = path.join(process.resourcesPath, "backend", name);
    return { cmd: exe, args: [], cwd: path.dirname(exe) };
  }
  // Dev: run straight from source with the system Python — same code path `py server.py` /
  // `python3 server.py` already uses, no PyInstaller round trip needed while iterating on
  // `npm start`. Windows ships the "py" launcher; macOS/Linux use "python3".
  const apiDir = path.join(__dirname, "..", "musicflow-api");
  const pythonCmd = process.platform === "win32" ? "py" : "python3";
  return { cmd: pythonCmd, args: ["electron_main.py"], cwd: apiDir };
}

function logPath() {
  return path.join(app.getPath("userData"), "electron.log");
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), line);
  } catch {
    // Logging is best-effort — never let a disk hiccup block startup.
  }
  console.log(...args);
}

// A crash here would otherwise be totally silent (no console — this is a windowed app — and
// no dialog unless we're the ones showing it), which cost real time to diagnose once already.
process.on("uncaughtException", (err) => log("UNCAUGHT EXCEPTION:", err.stack || err.message));

function waitForBackend(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("The backend didn't respond in time."));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function startBackend() {
  backendPort = await getFreePort();
  const { cmd, args, cwd } = backendCommand();
  log("Starting backend:", cmd, args.join(" "), "on port", backendPort);

  backendProcess = spawn(cmd, args, {
    cwd,
    env: { ...process.env, MUSICFLOW_PORT: String(backendPort) },
    windowsHide: true,
    // On posix, killBackend() below signals the whole process group via a negative pid — that
    // only works if this child is actually its own group leader, which spawn only does when
    // asked. Harmless no-op on Windows (windowsHide covers that platform's equivalent).
    detached: process.platform !== "win32",
  });

  backendProcess.stdout?.on("data", (d) => log("[backend]", d.toString().trim()));
  backendProcess.stderr?.on("data", (d) => log("[backend:err]", d.toString().trim()));
  backendProcess.on("exit", (code) => log("Backend process exited, code", code));
  backendProcess.on("error", (err) => log("Backend process failed to start:", err.message));

  await waitForBackend(backendPort);
}

/** child.kill() only signals the immediate process — yt-dlp shells out to ffmpeg for every
 * download, and a naive kill can orphan those (and, worse, leave the Python process itself
 * dangling if the signal doesn't land cleanly on Windows). taskkill /t kills the whole tree. */
function killBackend() {
  if (!backendProcess || backendProcess.pid == null) return;
  const pid = backendProcess.pid;
  backendProcess = null;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" });
    } catch {
      // Already gone — fine.
    }
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone — fine.
    }
  }
}

// Translates our renderer-side combo strings (see musicflow-dash/src/lib/keybinds.ts,
// comboFromEvent) into Electron's accelerator format — e.g. "Ctrl+ArrowLeft" ->
// "CommandOrControl+Left". Anything not in this table (plain letters/digits) passes through
// unchanged, since those already match accelerator key names as-is.
const ACCELERATOR_KEY_MAP = {
  Ctrl: "CommandOrControl",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

function acceleratorFromCombo(combo) {
  return combo
    .split("+")
    .map((part) => ACCELERATOR_KEY_MAP[part] ?? part)
    .join("+");
}

// Renderer decides *which* keybinds should be global (Settings > Keybinds) and pushes the list
// down over IPC any time it changes — main.js just (re)registers whatever it's handed with the
// OS and forwards each press back to the renderer, which already owns all the actual playback
// logic. Re-registering from scratch each time is simpler than diffing and cheap enough here.
function applyGlobalKeybinds(bindings) {
  globalShortcut.unregisterAll();
  for (const { actionId, combo } of bindings || []) {
    if (!actionId || !combo) continue;
    const accelerator = acceleratorFromCombo(combo);
    try {
      const ok = globalShortcut.register(accelerator, () => {
        // webContents stays alive (and keeps receiving IPC) even while the window is hidden
        // to the tray — only an actually-destroyed window would need a guard here.
        if (mainWindow && !mainWindow.isDestroyed()) {
          log(`[keybinds] "${accelerator}" fired -> ${actionId}`);
          mainWindow.webContents.send("keybinds:fire", actionId);
        }
      });
      if (!ok) log(`[keybinds] OS declined "${accelerator}" — likely already claimed by another app`);
    } catch (err) {
      log(`[keybinds] failed to register "${accelerator}":`, err.message);
    }
  }
}

ipcMain.on("keybinds:set", (_event, bindings) => applyGlobalKeybinds(bindings));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    title: "Musicflow",
    icon: iconPath(),
    // No native title bar — the app renders its own (TitleBar.tsx) with a drag region and
    // its own minimize/maximize/close buttons, wired up over IPC below.
    frame: false,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);

  // Silent GPU/renderer death (see disableHardwareAcceleration above) is exactly what a black,
  // unresponsive window looks like from the outside with nothing in the log to explain it —
  // this at least gets the reason on record if it ever happens again.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("Renderer process gone:", details.reason, "exitCode", details.exitCode);
  });

  // Settings has outbound links (Discord dev portal, Last.fm auth, ListenBrainz) — those
  // should open in the system browser, not navigate this window away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("maximize", () => mainWindow.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window:maximized-changed", false));

  // Close (the X button, via TitleBar.tsx) hides to the tray instead of quitting — music keeps
  // playing, same as most desktop players. Only an actual quit (tray menu, OS shutdown, ...)
  // lets the window really close; isQuitting is set by the before-quit handler below. Also
  // falls through to a real close if the tray failed to create (best-effort, see
  // app.whenReady below) — hiding with no tray icon would leave no way to get the window back.
  mainWindow.on("close", (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Tray icon — the only way back once the window's been hidden, and the "Quit" item is the
 * only way to actually exit now that closing the window just hides it. */
function createTray() {
  tray = new Tray(iconPath());
  tray.setToolTip("Musicflow");

  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Musicflow", click: showWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );

  // Left-click shows the window (Windows/Linux convention). macOS ignores this handler for
  // clicks on the tray icon itself — it always opens the context menu set above instead — so
  // this is a no-op there, not a bug.
  tray.on("click", showWindow);
}

// Frameless window (see createWindow) means the app's own TitleBar.tsx has to provide
// minimize/maximize/close itself — these just forward those clicks to the real BrowserWindow.
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);
// TitleBar.tsx's "end task" button — unlike window:close (which just hides to the tray, see
// the close handler above), this is a real quit: same path as the tray's own "Quit" item, so
// it still goes through before-quit/will-quit (killBackend, unregistering shortcuts, ...)
// rather than skipping cleanup and risking an orphaned backend process.
ipcMain.on("window:quit", () => {
  isQuitting = true;
  app.quit();
});

// This is silent by design everywhere else Electron apps do it, but that silence cost real
// debugging time once already (a leftover process from a previous run/crash holding the lock
// looks identical to "won't launch at all" with nothing in electron.log to explain why).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log("Another instance already holds the lock — focusing it and quitting this one.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // Also handles the tray-hidden case — show() on an already-visible window is a no-op.
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      createWindow();
      // Best-effort: the tray is a nice-to-have, not something that should take the whole app
      // down if icon loading ever breaks again on some machine — close (X) just quits instead.
      try {
        createTray();
      } catch (err) {
        log("Tray creation failed (continuing without it):", err.message);
      }
    } catch (err) {
      log("Startup failed:", err.message);
      dialog.showErrorBox(
        "Musicflow couldn't start",
        `${err.message}\n\nLog file: ${logPath()}`,
      );
      app.quit();
    }
  });

  app.on("child-process-gone", (_event, details) => {
    log("Child process gone:", details.type, details.reason, "exitCode", details.exitCode);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendPort) createWindow();
  });

  app.on("window-all-closed", () => {
    killBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    killBackend();
  });
  app.on("will-quit", () => {
    killBackend();
    globalShortcut.unregisterAll();
    tray?.destroy();
  });
}
