const { app, dialog, shell } = require("electron");
const https = require("https");

// Windows can update itself in place (electron-builder's NSIS target supports differential
// auto-update even unsigned — see musicflow-electron/README.md "Releasing"). macOS can't:
// Squirrel.Mac (the auto-update mechanism electron-updater would otherwise use there) refuses
// to run against an unsigned/unnotarized app, and this app is neither — right-click-Open is
// already the workaround for first launch, so a real "update in place" isn't on the table
// without paying for an Apple Developer cert. Mac instead just gets told a new version exists
// and is pointed at the release page to grab it manually, same as before this file existed.
function checkForUpdates(mainWindow, log) {
  if (!app.isPackaged) return; // noisy and pointless while running from source in dev
  if (process.platform === "win32") checkWindows(mainWindow, log);
  else if (process.platform === "darwin") checkMac(log);
}

function checkWindows(mainWindow, log) {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // we ask first — see update-downloaded below
  autoUpdater.logger = {
    info: (msg) => log("[updater]", msg),
    warn: (msg) => log("[updater] warn:", msg),
    error: (msg) => log("[updater] error:", msg),
  };

  autoUpdater.on("error", (err) => log("[updater] error:", err.message));

  autoUpdater.on("update-downloaded", (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Musicflow ${info.version} has been downloaded.`,
        detail: "Restart now to finish installing it, or it'll install next time you quit Musicflow.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdates().catch((err) => log("[updater] check failed:", err.message));
}

function checkMac(log) {
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
            promptMacUpdate(latestVersion, currentVersion, release.html_url);
          }
        } catch (err) {
          log("[updater] failed to parse release info:", err.message);
        }
      });
    },
  );
  req.on("error", (err) => log("[updater] check failed:", err.message));
}

function promptMacUpdate(latestVersion, currentVersion, releaseUrl) {
  dialog
    .showMessageBox({
      type: "info",
      buttons: ["Open download page", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Musicflow ${latestVersion} is available (you have ${currentVersion}).`,
      detail: "Musicflow can't install updates itself on macOS — download the new version and run it to update.",
    })
    .then(({ response }) => {
      if (response === 0) shell.openExternal(releaseUrl);
    });
}

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
