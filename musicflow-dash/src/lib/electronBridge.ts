/** Thin wrapper around the optional `window.musicflow` bridge exposed by musicflow-electron's
 * preload script. Undefined in the Vite dev server and in a plain browser tab — every call
 * here is a no-op in that case, so nothing needs to branch on "am I in Electron?" itself. */

export interface GlobalKeybind {
  actionId: string;
  combo: string;
}

export interface UpdateAvailableInfo {
  version: string;
  /** "auto" = Windows, updates in place. "manual" = macOS, can only point at the release page. */
  mode: "auto" | "manual";
}

export interface UpdateProgress {
  percent: number;
}

export interface UpdateReadyInfo {
  version: string;
}

declare global {
  interface Window {
    musicflow?: {
      setGlobalKeybinds: (bindings: GlobalKeybind[]) => void;
      onGlobalShortcut: (callback: (actionId: string) => void) => () => void;
      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      closeWindow: () => void;
      quitApp: () => void;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => () => void;
      onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
      onUpdateReady: (callback: (info: UpdateReadyInfo) => void) => () => void;
      downloadUpdate: () => void;
      installUpdate: () => void;
      openUpdatePage: () => void;
      getHardwareAcceleration: () => Promise<boolean>;
      setHardwareAcceleration: (enabled: boolean) => void;
      restartApp: () => void;
    };
  }
}

/** True only inside the Electron shell (preload.js runs before the page's own scripts, so
 * this is reliable immediately — no need to wait for an effect). */
export const isElectron = (): boolean => typeof window !== "undefined" && !!window.musicflow;

export const setGlobalKeybinds = (bindings: GlobalKeybind[]) => {
  window.musicflow?.setGlobalKeybinds(bindings);
};

/** Returns an unsubscribe function, or a no-op outside Electron. */
export const onGlobalShortcut = (callback: (actionId: string) => void): (() => void) => {
  return window.musicflow?.onGlobalShortcut(callback) ?? (() => {});
};

export const minimizeWindow = () => window.musicflow?.minimizeWindow();
export const toggleMaximizeWindow = () => window.musicflow?.toggleMaximizeWindow();
export const closeWindow = () => window.musicflow?.closeWindow();
/** A real quit (window + backend both terminate), unlike closeWindow which just hides to the
 * tray — the app keeps running in the background until this (or the tray's own "Quit") is
 * used. */
export const quitApp = () => window.musicflow?.quitApp();
export const isWindowMaximized = () =>
  window.musicflow?.isWindowMaximized() ?? Promise.resolve(false);
export const onWindowMaximizedChange = (callback: (maximized: boolean) => void): (() => void) => {
  return window.musicflow?.onWindowMaximizedChange(callback) ?? (() => {});
};

export const onUpdateAvailable = (callback: (info: UpdateAvailableInfo) => void): (() => void) => {
  return window.musicflow?.onUpdateAvailable(callback) ?? (() => {});
};
export const onUpdateProgress = (callback: (progress: UpdateProgress) => void): (() => void) => {
  return window.musicflow?.onUpdateProgress(callback) ?? (() => {});
};
export const onUpdateReady = (callback: (info: UpdateReadyInfo) => void): (() => void) => {
  return window.musicflow?.onUpdateReady(callback) ?? (() => {});
};
export const downloadUpdate = () => window.musicflow?.downloadUpdate();
export const installUpdate = () => window.musicflow?.installUpdate();
export const openUpdatePage = () => window.musicflow?.openUpdatePage();

/** Persisted locally in the Electron shell (see main.js), not backend settings — it has to be
 * readable before the backend even starts. Only takes effect after restartApp(). */
export const getHardwareAcceleration = () =>
  window.musicflow?.getHardwareAcceleration() ?? Promise.resolve(false);
export const setHardwareAcceleration = (enabled: boolean) =>
  window.musicflow?.setHardwareAcceleration(enabled);
export const restartApp = () => window.musicflow?.restartApp();
