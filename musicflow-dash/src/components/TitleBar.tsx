import { useEffect, useState } from "react";
import { Copy, Minus, Power, Square, X } from "lucide-react";
import {
  closeWindow,
  isElectron,
  isWindowMaximized,
  minimizeWindow,
  onWindowMaximizedChange,
  quitApp,
  toggleMaximizeWindow,
} from "@/lib/electronBridge";
import { useFullscreenChrome } from "@/hooks/useFullscreenChrome";
import { usePlayer } from "@/store/player";
import { cn } from "@/lib/utils";

/** Replaces the native Windows title bar (main.js creates the window with `frame: false`) —
 * the bar itself is a drag handle, its buttons forward to the real BrowserWindow over IPC.
 * Renders nothing outside Electron (Vite dev / a plain browser tab already has its own).
 *
 * This is the app's own window chrome, entirely separate from the full-screen player's own
 * header — it stays mounted regardless of that view. Three states:
 * - Normal browsing (full-screen player closed): the solid bar, always visible, as always.
 * - "Now Playing" open, windowed: the solid bar itself is gone entirely — just the bare
 *   buttons floating over the immersive view, idle-revealing on mouse movement like everything
 *   else there (see useFullscreenChrome).
 * - Real (OS-level) fullscreen: hidden outright, never reappears on mouse movement at all —
 *   only actually exiting real fullscreen (Escape) brings it back.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const fullscreen = usePlayer((s) => s.fullscreen);
  const { docFullscreen, mouseIdle } = useFullscreenChrome(fullscreen);
  // No separate bar to draw once the full-screen player is open at all — its own immersive
  // background takes over that space instead (see FullScreenPlayer's pt-9 reservation).
  const showBar = !fullscreen;
  const showButtons = !fullscreen ? true : docFullscreen ? false : !mouseIdle;

  useEffect(() => {
    if (!isElectron()) return;
    isWindowMaximized().then(setMaximized).catch(() => {});
    return onWindowMaximizedChange(setMaximized);
  }, []);

  if (!isElectron()) return null;

  // Rectangular flush-to-the-bar buttons only make sense against the bar itself — floating
  // over the immersive view instead, they get their own small translucent pill (matching the
  // full-screen player's own buttons) so they still read as buttons against busy art/visuals.
  const buttonClass = showBar
    ? "no-drag grid h-9 w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    : "no-drag grid h-8 w-8 place-items-center rounded-lg bg-card/60 text-muted-foreground backdrop-blur transition-colors hover:bg-card hover:text-foreground";
  const destructiveButtonClass = showBar
    ? "no-drag grid h-9 w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
    : "no-drag grid h-8 w-8 place-items-center rounded-lg bg-card/60 text-muted-foreground backdrop-blur transition-colors hover:bg-destructive hover:text-destructive-foreground";

  return (
    <div
      className={cn(
        "drag-region relative z-[100] flex h-9 shrink-0 items-center justify-end transition-opacity duration-300",
        showBar ? "bg-sidebar" : "gap-2 bg-transparent px-2",
        showButtons ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* "End task" — a real quit (window + backend process), unlike Close below which just
          hides to the tray and keeps playback/the backend running. Separated with a gap (not
          grouped with minimize/maximize/close) and its own tooltip specifically so it doesn't
          get mistaken for the regular close button — this one isn't undoable via the tray. */}
      <button
        onClick={quitApp}
        aria-label="End task (quit Musicflow completely, including the background process)"
        title="End task — quits completely, even from the background"
        className={cn(destructiveButtonClass, showBar && "mr-2")}
      >
        <Power className="h-4 w-4" />
      </button>
      <button onClick={minimizeWindow} aria-label="Minimize" className={buttonClass}>
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={toggleMaximizeWindow}
        aria-label={maximized ? "Restore" : "Maximize"}
        className={buttonClass}
      >
        {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button onClick={closeWindow} aria-label="Close" className={destructiveButtonClass}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
