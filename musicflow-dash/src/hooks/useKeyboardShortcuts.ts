import { useEffect } from "react";
import { usePlayer } from "@/store/player";
import { useLibrary } from "@/store/library";
import {
  comboFromEvent,
  effectiveGlobalBindings,
  isCapturingKeybind,
  parseCustomVolumeKeybinds,
  parseKeybinds,
  type KeybindActionId,
} from "@/lib/keybinds";
import { onGlobalShortcut, setGlobalKeybinds } from "@/lib/electronBridge";
import { shiftActiveLyrics } from "@/hooks/useLyrics";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

// While a lyrics-offset or volume key (all Up/Down by default) is held, native OS key-repeat
// re-fires keydown with e.repeat=true — ramp the step size the longer it's held so it "keeps
// incrementing fast" without a hand-rolled setInterval. Resets on keyup.
let holdCount = 0;
function accelStep(e: KeyboardEvent): number {
  holdCount = e.repeat ? Math.min(holdCount + 1, 40) : 0;
  return Math.min(1 + holdCount * 0.15, 3);
}

const VOLUME_STEP = 0.025;
// Round to the nearest half percent so repeated 2.5%-scaled steps don't drift off the
// intended increment the way rounding to a whole percent would.
const roundVolume = (v: number) => Math.round(v * 200) / 200;

/** Runs one keybind action. Shared by the in-app DOM listener (below, gets a real KeyboardEvent
 * so volume and lyrics-offset can accelerate on held-key repeat) and Electron's global-shortcut
 * IPC (fires once per press with just the action id, no repeat info — held-key accel doesn't
 * apply there). */
function runKeybindAction(action: KeybindActionId, e?: KeyboardEvent) {
  const s = usePlayer.getState();
  switch (action) {
    case "play-pause":
      e?.preventDefault();
      s.toggle();
      break;
    case "seek-backward":
      e?.preventDefault();
      s.seek(Math.max(0, s.currentTime - 5));
      break;
    case "seek-forward":
      e?.preventDefault();
      s.seek(Math.min(s.duration || Infinity, s.currentTime + 5));
      break;
    case "previous-track":
      e?.preventDefault();
      s.prev();
      break;
    case "next-track":
      e?.preventDefault();
      s.next(true);
      break;
    case "toggle-mute":
      e?.preventDefault();
      s.toggleMute();
      break;
    case "volume-up":
      e?.preventDefault();
      s.setVolume(Math.min(1, roundVolume(s.volume + VOLUME_STEP * (e ? accelStep(e) : 1))));
      break;
    case "volume-down":
      e?.preventDefault();
      s.setVolume(Math.max(0, roundVolume(s.volume - VOLUME_STEP * (e ? accelStep(e) : 1))));
      break;
    case "lyrics-offset-later":
      if (s.fullscreen && s.lyricsSynced) {
        e?.preventDefault();
        shiftActiveLyrics(e ? accelStep(e) : 1);
      }
      break;
    case "lyrics-offset-earlier":
      if (s.fullscreen && s.lyricsSynced) {
        e?.preventDefault();
        shiftActiveLyrics(e ? -accelStep(e) : -1);
      }
      break;
  }
}

/** Playback + lyrics-offset keyboard shortcuts, remapped via Settings > Keybinds. Also keeps
 * Electron's OS-level global shortcuts (Settings > Keybinds > global mode) in sync with the
 * current bindings, and dispatches them the same way when the app isn't focused. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isCapturingKeybind()) return;

      const settings = useLibrary.getState().settings;
      const bindings = parseKeybinds(settings.keybinds);
      const combo = comboFromEvent(e);
      const action = (Object.keys(bindings) as KeybindActionId[]).find(
        (id) => bindings[id] === combo,
      );
      if (action) {
        runKeybindAction(action, e);
        return;
      }

      const customVolume = parseCustomVolumeKeybinds(settings.customVolumeKeybinds).find(
        (c) => c.combo === combo,
      );
      if (customVolume) {
        e.preventDefault();
        usePlayer.getState().setVolume(customVolume.percent / 100);
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

  // Push the current global-shortcut set to Electron whenever the relevant settings change
  // (no-op outside Electron). Re-runs on every settings change since keybinds/mode/selection
  // can each change independently and all three feed into what should be registered.
  const settings = useLibrary((s) => s.settings);
  useEffect(() => {
    const bindings = parseKeybinds(settings.keybinds);
    setGlobalKeybinds(effectiveGlobalBindings(settings.keybindGlobalMode, bindings, settings.globalKeybinds));
  }, [settings.keybinds, settings.keybindGlobalMode, settings.globalKeybinds]);

  useEffect(() => {
    return onGlobalShortcut((actionId) => runKeybindAction(actionId as KeybindActionId));
  }, []);
}
