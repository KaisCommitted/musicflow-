import { useEffect, useState } from "react";
import {
  downloadUpdate,
  installUpdate,
  onUpdateAvailable,
  onUpdateProgress,
  onUpdateReady,
  openUpdatePage,
} from "@/lib/electronBridge";

type UpdateStatus = "idle" | "available" | "downloading" | "installing";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  /** "auto" = Windows, updates itself in place. "manual" = macOS, can only open the release
   * page — there's never a downloading/installing state for it, "available" is the whole
   * story. */
  mode: "auto" | "manual" | null;
  percent: number;
}

/** Drives UpdateBanner.tsx (the small "available" pill) and UpdateSplash.tsx (the full-screen
 * takeover for downloading/installing) — main process (updater.js) only checks and reports
 * state over IPC, this owns what the user actually sees. Once a download finishes it installs
 * immediately, no "ready, click restart" prompt — the only choice offered is starting the
 * update in the first place. No-op outside Electron (every onUpdate* subscription below is a
 * no-op there too, see electronBridge.ts). */
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
      // Don't ask — just install. There's no way to show real progress once quitAndInstall
      // actually fires (the whole Electron process, and everything it's rendering, is gone
      // before the installer even starts), so this beat of "installing" is what UpdateSplash
      // shows instead — long enough to register, short enough not to feel like a delay for
      // its own sake — before the app quits out from under it.
      setState((s) => ({ ...s, status: "installing", version, percent: 100 }));
      setTimeout(() => installUpdate(), 1200);
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
  };
}
