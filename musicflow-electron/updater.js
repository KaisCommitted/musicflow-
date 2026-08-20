const { app, ipcMain, shell } = require("electron");
const https = require("https");

// Windows can update itself in place (electron-builder's NSIS target supports this even
// unsigned — see musicflow-electron/README.md "Update checks"). macOS can't: Squirrel.Mac (the
// mechanism electron-updater would otherwise use there) refuses to run against an
// unsigned/unnotarized app, and this app is neither. Mac instead just gets told a new version
// exists and is pointed at the release page to grab it manually.
//
// Neither platform downloads or installs anything on its own — this only checks and tells the
// renderer, which owns the actual banner/progress UI (see UpdateBanner.tsx) and asks back over
// IPC (update:download / update:install / update:open-page) once the user actually clicks it.
function checkForUpdates(mainWindow, log) {
  if (!app.isPackaged) return; // noisy and pointless while running from source in dev
  if (process.platform === "win32") checkWindows(mainWindow, log);
  else if (process.platform === "darwin") checkMac(mainWindow, log);
}

function send(mainWindow, channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function checkWindows(mainWindow, log) {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false; // renderer asks for it explicitly, see update:download below
  autoUpdater.autoInstallOnAppQuit = false;
  // v1.7.0 -> v1.7.1 briefly broke differential downloads: the installer's filename changed
  // (versioned -> stable, see git history), so electron-updater's guessed URL for the *old*
  // version's blockmap 404'd. Always doing a full download avoids that whole class of bug, at
  // the cost of always paying full size -- fine for a small friends-and-family install base.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = {
    info: (msg) => log("[updater]", msg),
    warn: (msg) => log("[updater] warn:", msg),
    error: (msg) => log("[updater] error:", msg),
  };

  autoUpdater.on("error", (err) => log("[updater] error:", err.message));
  autoUpdater.on("update-available", (info) => {
    send(mainWindow, "update:available", { version: info.version, mode: "auto" });
  });
  autoUpdater.on("download-progress", (progress) => {
    send(mainWindow, "update:progress", { percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    send(mainWindow, "update:ready", { version: info.version });
  });

  ipcMain.on("update:download", () => {
    autoUpdater.downloadUpdate().catch((err) => log("[updater] download failed:", err.message));
  });
  ipcMain.on("update:install", () => {
    // isSilent + isForceRunAfter: no NSIS installer wizard, just quit, install in the
    // background, and relaunch -- the renderer's own progress UI already carried the "this is
    // updating" story, so this should read as one continuous step, not a second unfamiliar
    // window on top of it.
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.checkForUpdates().catch((err) => log("[updater] check failed:", err.message));
}

let macReleaseUrl = null;

function checkMac(mainWindow, log) {
  const currentVersion = app.getVersion();
  const req = https.get(
    {
      hostname: "api.github.com",
      path: "/repos/KaisCommitted/musicflow-/releases/latest",
      headers: { "User-Agent": "musicflow-electron" },
    },
    (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const release = JSON.parse(body);
          const latestVersion = String(release.tag_name || "").replace(/^v/, "");
          if (latestVersion && isNewer(latestVersion, currentVersion)) {
            macReleaseUrl = release.html_url;
            send(mainWindow, "update:available", { version: latestVersion, mode: "manual" });
          }
        } catch (err) {
          log("[updater] failed to parse release info:", err.message);
        }
      });
    },
  );
  req.on("error", (err) => log("[updater] check failed:", err.message));
}

ipcMain.on("update:open-page", () => {
  if (macReleaseUrl) shell.openExternal(macReleaseUrl);
});

/** Plain dotted-integer semver compare (no pre-release suffixes — release tags are always
 * "v<major>.<minor>.<patch>", see the Release workflow). */
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

module.exports = { checkForUpdates };
