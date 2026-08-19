/** Thin wrapper around the optional `window.musicflow` bridge exposed by musicflow-electron's
 * preload script. Undefined in the Vite dev server and in a plain browser tab — every call
 * here is a no-op in that case, so nothing needs to branch on "am I in Electron?" itself. */

export interface GlobalKeybind {
  actionId: string;
  combo: string;
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
export const isWindowMaximized = () => window.musicflow?.isWindowMaximized() ?? Promise.resolve(false);
export const onWindowMaximizedChange = (callback: (maximized: boolean) => void): (() => void) => {
  return window.musicflow?.onWindowMaximizedChange(callback) ?? (() => {});
};
