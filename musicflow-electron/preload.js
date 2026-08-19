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
});
