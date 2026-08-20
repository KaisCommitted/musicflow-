import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/** Floating pill above the player bar — mirrors BulkActionsBar's placement/animation language,
 * just anchored bottom-right instead of centered so it never collides with it. Replaces the
 * native "a new version is available" dialog box the update flow used to show.
 *
 * Only owns the "available" moment — clicking Update hands off to UpdateSplash.tsx, a
 * full-screen takeover ("hide the app") that owns downloading and installing, and installs
 * automatically the moment the download finishes with no further prompt. See updater.js and
 * useAppUpdate.ts for the state machine both of these render. */
export function UpdateBanner() {
  const update = useAppUpdate();
  const visible = update.status === "available" && !update.dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="fixed bottom-28 right-4 z-40 w-80 rounded-2xl border border-border bg-card p-4 shadow-elevated"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Musicflow {update.version} is available
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {update.mode === "auto"
                  ? "Updates and restarts itself automatically once it's downloaded."
                  : "Download it and run it to update."}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={update.start}>
                  {update.mode === "auto" ? "Update" : "Download"}
                </Button>
                <Button size="sm" variant="ghost" onClick={update.dismiss}>
                  Later
                </Button>
              </div>
            </div>
          </div>

          <button
            onClick={update.dismiss}
            aria-label="Dismiss"
            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
