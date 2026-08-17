import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import {
  closeWindow,
  isElectron,
  isWindowMaximized,
  minimizeWindow,
  onWindowMaximizedChange,
  toggleMaximizeWindow,
} from "@/lib/electronBridge";
import { cn } from "@/lib/utils";

/** Replaces the native Windows title bar (main.js creates the window with `frame: false`) —
 * the bar itself is a drag handle, its buttons forward to the real BrowserWindow over IPC.
 * Renders nothing outside Electron (Vite dev / a plain browser tab already has its own). */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    isWindowMaximized().then(setMaximized).catch(() => {});
    return onWindowMaximizedChange(setMaximized);
  }, []);

  if (!isElectron()) return null;

  return (
    <div className="drag-region relative z-[100] flex h-9 shrink-0 items-center justify-end bg-sidebar">
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
