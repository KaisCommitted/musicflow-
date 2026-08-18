const { app, BrowserWindow, Tray, Menu, dialog, shell, globalShortcut, ipcMain, session } = require("electron");
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

/** `build/` is only packaged as far as electron-builder's own `win.icon` (it bakes the icon
 * into the compiled .exe's resources at build time) — it was never actually included in the
 * app bundle for main.js to read at runtime, so this path resolved to a file that didn't
 * exist inside app.asar. BrowserWindow's `icon` option failed silently on that; `new Tray()`
 * does not — it throws, which is what actually surfaced this. Fixed by shipping the icon as
 * a real extraResource (see package.json) instead of reading it from inside the asar. */
function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "build", "icon.ico");
}

function backendCommand() {
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, "backend", "musicflow-backend.exe");
    return { cmd: exe, args: [], cwd: path.dirname(exe) };
  }
  // Dev: run straight from source with the system Python — same code path `py server.py`
  // already uses, no PyInstaller round trip needed while iterating on `npm start`.
  const apiDir = path.join(__dirname, "..", "musicflow-api");
  return { cmd: "py", args: ["electron_main.py"], cwd: apiDir };
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

// A dedicated, isolated session used for nothing else — signing in here and reading the
// resulting cookies is a plain first-party API call (this app reading a session it owns), not
// an outside tool decrypting another program's storage the way reading a real installed
// browser's cookie file is. That's what actually makes this work everywhere: Chromium's
// "App-Bound Encryption" (see musicflow-api/main.py) blocks the latter on every real browser
// (Chrome, Edge, Brave, ...) with no known workaround, but doesn't apply here at all.
const YOUTUBE_LOGIN_PARTITION = "persist:youtube-login";
// Google refuses to even show its sign-in page ("This browser or app may not be secure") to
// user agents it flags as an embedded webview — Electron's default UA includes an
// "Electron/x.x.x" token that trips this. Overriding it to a plain desktop Chrome UA is the
// standard fix other Electron apps use for exactly this.
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const YOUTUBE_AUTH_COOKIE_NAMES = new Set(["SAPISID", "SID", "__Secure-3PSID", "LOGIN_INFO"]);

async function currentYoutubeLoginCookies(loginSession) {
  const [youtube, google] = await Promise.all([
    loginSession.cookies.get({ domain: ".youtube.com" }),
    loginSession.cookies.get({ domain: ".google.com" }),
  ]);
  return [...youtube, ...google];
}

ipcMain.handle("youtube-login:open", () => {
  const loginSession = session.fromPartition(YOUTUBE_LOGIN_PARTITION);
  loginSession.setUserAgent(DESKTOP_CHROME_UA);

  return new Promise((resolve) => {
    let settled = false;
    let settleTimer = null;

    const win = new BrowserWindow({
      width: 520,
      height: 700,
      parent: mainWindow,
      modal: true,
      icon: iconPath(),
      autoHideMenuBar: true,
      title: "Sign in to YouTube",
      webPreferences: {
        session: loginSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(settleTimer);
      loginSession.cookies.removeListener("changed", onCookieChange);
      win.removeListener("closed", onClosed);
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    const onCookieChange = (_event, cookie, _cause, removed) => {
      if (settled || removed || !YOUTUBE_AUTH_COOKIE_NAMES.has(cookie.name)) return;
      // A real login lands several cookies across a couple of redirects, not all in the same
      // tick — debounce briefly after the first sign of one so the export isn't missing the
      // rest of them.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(async () => {
        const cookies = await currentYoutubeLoginCookies(loginSession);
        finish({ ok: true, cookies });
      }, 1500);
    };
    const onClosed = () => finish({ ok: false });

    loginSession.cookies.on("changed", onCookieChange);
    win.on("closed", onClosed);

    win.loadURL("https://www.youtube.com/").catch((err) => {
      log("[youtube-login] failed to load:", err.message);
      finish({ ok: false });
    });
  });
});

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

/** Windows tray icon — the only way back once the window's been hidden, and the "Quit" item
 * is the only way to actually exit now that closing the window just hides it. */
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

  // Left-click (Windows convention — macOS/Linux tray clicks open the context menu instead,
  // not relevant here since this app only ships for Windows).
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
