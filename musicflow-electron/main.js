const { app, BrowserWindow, dialog, shell, globalShortcut, ipcMain } = require("electron");
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
        if (mainWindow && !mainWindow.isDestroyed()) {
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
    icon: path.join(__dirname, "build", "icon.ico"),
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      createWindow();
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

  app.on("before-quit", killBackend);
  app.on("will-quit", () => {
    killBackend();
    globalShortcut.unregisterAll();
  });
}
