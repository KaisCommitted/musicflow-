/** Thin wrapper around the optional `window.musicflow` bridge exposed by musicflow-electron's
 * preload script. Undefined in the Vite dev server and in a plain browser tab — every call
 * here is a no-op in that case, so nothing needs to branch on "am I in Electron?" itself. */

export interface GlobalKeybind {
  actionId: string;
  combo: string;
}

/** Shape of a single Electron `session.cookies` entry, trimmed to just what the backend needs
 * to write a Netscape-format cookie file (see setup_youtube_cookies_from_electron in main.py) —
 * not the full Electron Cookie type. */
export interface YoutubeLoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  hostOnly: boolean;
  expirationDate?: number;
}

export interface YoutubeLoginResult {
  ok: boolean;
  cookies?: YoutubeLoginCookie[];
}

declare global {
  interface Window {
    musicflow?: {
      setGlobalKeybinds: (bindings: GlobalKeybind[]) => void;
      onGlobalShortcut: (callback: (actionId: string) => void) => () => void;
      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      closeWindow: () => void;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      openYoutubeLogin: () => Promise<YoutubeLoginResult>;
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
export const isWindowMaximized = () => window.musicflow?.isWindowMaximized() ?? Promise.resolve(false);
export const onWindowMaximizedChange = (callback: (maximized: boolean) => void): (() => void) => {
  return window.musicflow?.onWindowMaximizedChange(callback) ?? (() => {});
};

/** Opens Musicflow's own in-app YouTube sign-in window and resolves once a real login is
 * detected (see main.js). No system-browser fallback outside Electron — DownloadPage only
 * renders the connect card when isElectron() is true, so this no-op resolution is never
 * actually reachable from the UI, just a safe default for the type. */
export const openYoutubeLogin = (): Promise<YoutubeLoginResult> =>
  window.musicflow?.openYoutubeLogin() ?? Promise.resolve({ ok: false });
