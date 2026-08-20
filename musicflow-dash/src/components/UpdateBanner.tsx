import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/** Floating pill above the player bar — mirrors BulkActionsBar's placement/animation language,
 * just anchored bottom-right instead of centered so it never collides with it. Replaces the
 * native "Restart now / Later" dialog box the update flow used to show: this is coherent with
 * the rest of the app, never auto-downloads, and never pops the NSIS installer window — see
 * updater.js and useAppUpdate.ts for the state machine this renders. */
export function UpdateBanner() {
  const update = useAppUpdate();
  const visible = update.status !== "idle" && !update.dismissed;

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
          {update.status === "available" && (
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
                    ? "Update in the background, then restart when you're ready."
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
          )}

          {update.status === "downloading" && (
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <Download className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Downloading update…</p>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${update.percent}%` }}
                    transition={{ ease: "easeOut", duration: 0.25 }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{update.percent}%</p>
              </div>
            </div>
          )}

          {update.status === "ready" && (
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <RefreshCw className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Musicflow {update.version} is ready
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Restart to finish installing it.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={update.install}>
                    Restart now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={update.dismiss}>
                    Later
                  </Button>
                </div>
              </div>
            </div>
          )}

          {update.status !== "downloading" && (
            <button
              onClick={update.dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
