import { AnimatePresence, motion } from "framer-motion";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/** Full-screen takeover for the two update states that shouldn't be worked around: while it's
 * actually downloading, and the brief "installing" beat before the app quits to install
 * silently (no NSIS wizard window — see updater.js). Covers the whole app on purpose ("hide
 * the app" was the ask) instead of a small banner like UpdateBanner.tsx's "available" state,
 * since there's nothing useful to do mid-update and no further choice to make either — it
 * installs and restarts itself the moment the download finishes, no prompt. */
export function UpdateSplash() {
  const update = useAppUpdate();
  const visible = update.status === "downloading" || update.status === "installing";
  const installing = update.status === "installing";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-background"
        >
          <motion.div
            animate={{ opacity: [0.5, 0.9, 0.5], scale: [1, 1.06, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute h-64 w-64 rounded-full bg-primary/20 blur-3xl"
          />
          {/* The soft blurred circle above already carries the ambient glow — a box-shadow
           * directly on the SVG (a square element) would show up as a visible square halo
           * instead of a soft aura, so this stays plain. */}
          <AnimatedLogo className="relative h-24 w-24" />

          <div className="relative flex flex-col items-center gap-2 text-center">
            <p className="text-lg font-semibold text-foreground">
              {installing
                ? `Installing Musicflow ${update.version ?? ""}`.trim()
                : `Downloading Musicflow ${update.version ?? ""}`.trim()}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {installing
                ? "Almost there — Musicflow will reopen itself in a moment. No need to relaunch it yourself."
                : "This'll just take a moment."}
            </p>
          </div>

          <div className="relative w-64">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: installing ? "100%" : `${update.percent}%` }}
                transition={{ ease: "easeOut", duration: 0.25 }}
              />
            </div>
            {!installing && (
              <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
                {update.percent}%
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
