import { useEffect } from "react";
import { usePlayer } from "@/store/player";
import { useLibrary } from "@/store/library";
import { comboFromEvent, isCapturingKeybind, parseKeybinds, type KeybindActionId } from "@/lib/keybinds";
import { shiftActiveLyrics } from "@/hooks/useLyrics";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

// While a lyrics-offset key (Up/Down by default) is held, native OS key-repeat re-fires keydown
// with e.repeat=true — ramp the step size the longer it's held so it "keeps incrementing fast"
// without a hand-rolled setInterval. Resets on keyup.
let holdCount = 0;
function accelStep(e: KeyboardEvent): number {
  holdCount = e.repeat ? Math.min(holdCount + 1, 40) : 0;
  return Math.min(1 + holdCount * 0.15, 3);
}

/** Global playback + lyrics-offset keyboard shortcuts, remapped via Settings > Keybinds. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isCapturingKeybind()) return;

      const bindings = parseKeybinds(useLibrary.getState().settings.keybinds);
      const combo = comboFromEvent(e);
      const action = (Object.keys(bindings) as KeybindActionId[]).find(
        (id) => bindings[id] === combo,
      );
      if (!action) return;

      const s = usePlayer.getState();
      switch (action) {
        case "play-pause":
          e.preventDefault();
          s.toggle();
          break;
        case "seek-backward":
          e.preventDefault();
          s.seek(Math.max(0, s.currentTime - 5));
          break;
        case "seek-forward":
          e.preventDefault();
          s.seek(Math.min(s.duration || Infinity, s.currentTime + 5));
          break;
        case "previous-track":
          e.preventDefault();
          s.prev();
          break;
        case "next-track":
          e.preventDefault();
          s.next(true);
          break;
        case "toggle-mute":
          e.preventDefault();
          s.toggleMute();
          break;
        case "volume-up":
          e.preventDefault();
          s.setVolume(Math.min(1, Math.round((s.volume + 0.05) * 100) / 100));
          break;
        case "volume-down":
          e.preventDefault();
          s.setVolume(Math.max(0, Math.round((s.volume - 0.05) * 100) / 100));
          break;
        case "lyrics-offset-later":
          if (s.fullscreen && s.lyricsSynced) {
            e.preventDefault();
            shiftActiveLyrics(accelStep(e));
          }
          break;
        case "lyrics-offset-earlier":
          if (s.fullscreen && s.lyricsSynced) {
            e.preventDefault();
            shiftActiveLyrics(-accelStep(e));
          }
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") holdCount = 0;
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
