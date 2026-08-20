const { contextBridge, ipcRenderer } = require("electron");

// contextIsolation is on (see main.js), so the renderer can't reach ipcRenderer directly —
// this exposes just the two calls it needs for global keybinds, nothing broader.
contextBridge.exposeInMainWorld("musicflow", {
  setGlobalKeybinds: (bindings) => ipcRenderer.send("keybinds:set", bindings),
  onGlobalShortcut: (callback) => {
    const listener = (_event, actionId) => callback(actionId);
    ipcRenderer.on("keybinds:fire", listener);
    return () => ipcRenderer.removeListener("keybinds:fire", listener);
  },

  // Frameless window (see main.js createWindow) — TitleBar.tsx is the only way to
  // minimize/maximize/close, so it needs a way to ask the real BrowserWindow to do it.
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  // A real quit (window + backend), unlike closeWindow which just hides to the tray.
  quitApp: () => ipcRenderer.send("window:quit"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximizedChange: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("window:maximized-changed", listener);
  },

  // Update banner (see updater.js) — main only checks and reports state; the renderer owns
  // the actual UI and asks back for each step the user takes.
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("update:available", listener);
    return () => ipcRenderer.removeListener("update:available", listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
  onUpdateReady: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("update:ready", listener);
    return () => ipcRenderer.removeListener("update:ready", listener);
  },
  downloadUpdate: () => ipcRenderer.send("update:download"),
  installUpdate: () => ipcRenderer.send("update:install"),
  openUpdatePage: () => ipcRenderer.send("update:open-page"),
});
