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
import { cn } from "@/lib/utils";

/** Replaces the native Windows title bar (main.js creates the window with `frame: false`) —
 * the bar itself is a drag handle, its buttons forward to the real BrowserWindow over IPC.
 * Renders nothing outside Electron (Vite dev / a plain browser tab already has its own).
 *
 * This is the app's own window chrome, entirely separate from the full-screen player's own
 * header — it stays mounted regardless of that view, so it needs its own real-fullscreen hide
 * (see useFullscreenChrome) or it would sit on top of an immersive real-fullscreen view
 * forever, "exit"/minimize buttons and all. Unlike the full-screen player's lyrics controls, this
 * never reappears on mouse movement while in real fullscreen — only on actually exiting it
 * (Escape, which the Fullscreen API already handles natively). */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { docFullscreen } = useFullscreenChrome();

  useEffect(() => {
    if (!isElectron()) return;
    isWindowMaximized().then(setMaximized).catch(() => {});
    return onWindowMaximizedChange(setMaximized);
  }, []);

  if (!isElectron()) return null;

  return (
    <div
      className={cn(
        "drag-region relative z-[100] flex h-9 shrink-0 items-center justify-end bg-sidebar transition-opacity duration-300",
        docFullscreen ? "pointer-events-none opacity-0" : "opacity-100",
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
        className="no-drag mr-2 grid h-9 w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
      >
        <Power className="h-4 w-4" />
      </button>
      <button
        onClick={minimizeWindow}
        aria-label="Minimize"
        className="no-drag grid h-9 w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={toggleMaximizeWindow}
        aria-label={maximized ? "Restore" : "Maximize"}
        className="no-drag grid h-9 w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={closeWindow}
        aria-label="Close"
        className={cn(
          "no-drag grid h-9 w-11 place-items-center text-muted-foreground transition-colors",
          "hover:bg-destructive hover:text-destructive-foreground",
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
