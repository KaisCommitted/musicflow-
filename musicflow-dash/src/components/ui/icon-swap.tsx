import { AnimatePresence, motion } from "framer-motion";

/** Crossfades+pops between two icon states in place — used for anything that swaps its
 * icon based on state (play/pause, repeat mode, volume level, shuffle) so the change
 * reads as a transition rather than an instant flicker. `id` must change whenever the
 * icon should swap (e.g. the state value itself). */
export function IconSwap({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={id}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="grid place-items-center"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
