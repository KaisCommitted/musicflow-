import { useState } from "react";
import { motion } from "framer-motion";
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
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md text-center"
      >
        <motion.span
          initial={{ scale: 0.6, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
          className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow"
        >
          <FolderSearch className="h-7 w-7" />
        </motion.span>
        <h1 className="mt-5 text-xl font-bold">
          {isMissing ? "Music folder not found" : "Welcome to Musicflow"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isMissing
            ? `${musicFolder} couldn't be found — it may have been moved or renamed. Choose a folder to continue.`
            : "Choose the folder where your music lives. New YouTube downloads are saved here too."}
        </p>

        <div className="mt-6 flex justify-center">
          <FolderPicker
            value={draft}
            onChange={setDraft}
            className="flex w-full items-center gap-2"
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => void handleConfirm()}
          disabled={!draft || loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? "Checking…" : "Continue"}
        </motion.button>
      </motion.div>
    </div>
  );
}
