import { useEffect, useState } from "react";
import {
  downloadUpdate,
  installUpdate,
  onUpdateAvailable,
  onUpdateProgress,
  onUpdateReady,
  openUpdatePage,
} from "@/lib/electronBridge";

type UpdateStatus = "idle" | "available" | "downloading" | "ready";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  /** "auto" = Windows, updates itself in place. "manual" = macOS, can only open the release
   * page — there's never a download/progress/ready state for it, "available" is the whole
   * story. */
  mode: "auto" | "manual" | null;
  percent: number;
}

/** Drives UpdateBanner.tsx — main process (updater.js) only checks and reports state over IPC,
 * this owns what the user actually sees and asks back for each step they take. No-op outside
 * Electron (every onUpdate* subscription below is a no-op there too, see electronBridge.ts). */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    version: null,
    mode: null,
    percent: 0,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const offAvailable = onUpdateAvailable(({ version, mode }) => {
      setState({ status: "available", version, mode, percent: 0 });
      setDismissed(false);
    });
    const offProgress = onUpdateProgress(({ percent }) => {
      setState((s) => ({ ...s, status: "downloading", percent }));
    });
    const offReady = onUpdateReady(({ version }) => {
      setState((s) => ({ ...s, status: "ready", version, percent: 100 }));
    });
    return () => {
      offAvailable();
      offProgress();
      offReady();
    };
  }, []);

  return {
    ...state,
    dismissed,
    dismiss: () => setDismissed(true),
    // "auto": start the in-place download. "manual": there's nothing to download, just send
    // the user to the release page.
    start: () => {
      if (state.mode === "auto") {
        setState((s) => ({ ...s, status: "downloading", percent: 0 }));
        downloadUpdate();
      } else {
        openUpdatePage();
      }
    },
    install: installUpdate,
  };
}
