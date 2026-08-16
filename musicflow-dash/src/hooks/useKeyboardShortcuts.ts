import { useEffect } from "react";
import { usePlayer } from "@/store/player";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/** Global playback keyboard shortcuts. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = usePlayer.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          s.toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) s.prev();
          else s.seek(Math.max(0, s.currentTime - 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) s.next(true);
          else s.seek(Math.min(s.duration || Infinity, s.currentTime + 5));
          break;
        case "m":
        case "M":
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          s.toggleMute();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
