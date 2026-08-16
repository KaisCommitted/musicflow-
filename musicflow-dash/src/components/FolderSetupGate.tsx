import { useState } from "react";
import { FolderSearch, Loader2 } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { useLibrary } from "@/store/library";

/**
 * Blocks the whole app until a valid music folder is configured. Shown when no folder has
 * ever been set, or when the configured one can no longer be found (moved, renamed, unplugged).
 * This folder is also where new YouTube downloads are saved.
 */
export function FolderSetupGate() {
  const musicFolder = useLibrary((s) => s.settings.musicFolder);
  const error = useLibrary((s) => s.error);
  const loading = useLibrary((s) => s.loading);
  const updateSettings = useLibrary((s) => s.updateSettings);
  const refresh = useLibrary((s) => s.refresh);
  const [draft, setDraft] = useState(musicFolder);

  const isMissing = Boolean(musicFolder) && Boolean(error);

  const handleConfirm = async () => {
    updateSettings({ musicFolder: draft });
    await refresh();
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
          <FolderSearch className="h-7 w-7" />
        </span>
        <h1 className="mt-5 text-xl font-bold">
          {isMissing ? "Music folder not found" : "Welcome to Musicflow"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isMissing
            ? `${musicFolder} couldn't be found — it may have been moved or renamed. Choose a folder to continue.`
            : "Choose the folder where your music lives. New YouTube downloads are saved here too."}
        </p>

        <div className="mt-6 flex justify-center">
          <FolderPicker value={draft} onChange={setDraft} className="flex w-full items-center gap-2" />
        </div>

        <button
          onClick={() => void handleConfirm()}
          disabled={!draft || loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? "Checking…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
