/** Global playback/lyrics keybind registry — remappable in Settings. */

export type KeybindActionId =
  | "play-pause"
  | "seek-backward"
  | "seek-forward"
  | "previous-track"
  | "next-track"
  | "toggle-mute"
  | "volume-up"
  | "volume-down"
  | "lyrics-offset-later"
  | "lyrics-offset-earlier";

export interface KeybindAction {
  id: KeybindActionId;
  label: string;
  description: string;
  category: "Playback" | "Lyrics";
}

export const KEYBIND_ACTIONS: KeybindAction[] = [
  { id: "play-pause", label: "Play / Pause", description: "Toggle playback", category: "Playback" },
  { id: "seek-backward", label: "Seek back 5s", description: "Rewind the current song", category: "Playback" },
  { id: "seek-forward", label: "Seek forward 5s", description: "Fast-forward the current song", category: "Playback" },
  { id: "previous-track", label: "Previous track", description: "Jump to the previous song", category: "Playback" },
  { id: "next-track", label: "Next track", description: "Skip to the next song", category: "Playback" },
  { id: "toggle-mute", label: "Mute / unmute", description: "Toggle volume mute", category: "Playback" },
  { id: "volume-up", label: "Volume up", description: "Raise the volume 5%", category: "Playback" },
  { id: "volume-down", label: "Volume down", description: "Lower the volume 5%", category: "Playback" },
  {
    id: "lyrics-offset-later",
    label: "Delay lyrics",
    description: "Nudge synced lyrics +1s later (full-screen player, hold to speed up)",
    category: "Lyrics",
  },
  {
    id: "lyrics-offset-earlier",
    label: "Advance lyrics",
    description: "Nudge synced lyrics -1s earlier (full-screen player, hold to speed up)",
    category: "Lyrics",
  },
];

export const DEFAULT_KEYBINDS: Record<KeybindActionId, string> = {
  "play-pause": "Space",
  "seek-backward": "ArrowLeft",
  "seek-forward": "ArrowRight",
  "previous-track": "Ctrl+ArrowLeft",
  "next-track": "Ctrl+ArrowRight",
  "toggle-mute": "M",
  "volume-up": "Ctrl+ArrowUp",
  "volume-down": "Ctrl+ArrowDown",
  "lyrics-offset-later": "ArrowUp",
  "lyrics-offset-earlier": "ArrowDown",
};

const ARROW_SYMBOLS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** Canonical combo string from a live KeyboardEvent, e.g. "Ctrl+Shift+ArrowLeft". Ctrl and Cmd
 * collapse to one "Ctrl" modifier, matching how prev/next already treated them before this. */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join("+");
}

/** Display form for Settings, e.g. "Ctrl + ←". */
export function formatCombo(combo: string): string {
  if (!combo) return "Unbound";
  return combo
    .split("+")
    .map((part) => ARROW_SYMBOLS[part] ?? part)
    .join(" + ");
}

export function parseKeybinds(raw: string | undefined): Record<KeybindActionId, string> {
  if (!raw) return DEFAULT_KEYBINDS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<KeybindActionId, string>>;
    return { ...DEFAULT_KEYBINDS, ...parsed };
  } catch {
    return DEFAULT_KEYBINDS;
  }
}

/** "off": keybinds only fire while Musicflow is focused (default browser/DOM behavior).
 * "all": every Playback keybind also fires system-wide, via Electron's OS-level shortcuts.
 * "custom": same, but only for the actions listed in the `globalKeybinds` setting. */
export type KeybindGlobalMode = "off" | "all" | "custom";

// Global (system-wide) shortcuts only make sense for Playback actions — Lyrics offset only
// does anything while the full-screen player with synced lyrics is already open in-app.
export const GLOBAL_ELIGIBLE_CATEGORY = "Playback" as const;

/** A combo with no modifier (bare "Space", "M", "ArrowLeft", ...) can't safely go system-wide:
 * registering it as an OS-level hotkey would swallow that key everywhere, in every other app,
 * for as long as Musicflow is running — not just while typing, in every text field on the PC. */
export function canBeGlobal(combo: string): boolean {
  return combo.includes("+");
}

export function parseGlobalKeybinds(raw: string | undefined): Set<KeybindActionId> {
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as KeybindActionId[]);
  } catch {
    return new Set();
  }
}

/** The {actionId, combo} pairs that should actually be registered as OS-level shortcuts right
 * now, given the current mode/bindings — already filtered down to what's both selected and
 * safe (bound + has a modifier). Shared by the sync-to-Electron effect and the Settings UI. */
export function effectiveGlobalBindings(
  mode: KeybindGlobalMode,
  bindings: Record<KeybindActionId, string>,
  globalKeybinds: string | undefined,
): { actionId: KeybindActionId; combo: string }[] {
  if (mode === "off") return [];
  const chosen = mode === "custom" ? parseGlobalKeybinds(globalKeybinds) : null;
  return KEYBIND_ACTIONS.filter((a) => a.category === GLOBAL_ELIGIBLE_CATEGORY)
    .filter((a) => (chosen ? chosen.has(a.id) : true))
    .map((a) => ({ actionId: a.id, combo: bindings[a.id] }))
    .filter((b) => b.combo && canBeGlobal(b.combo));
}

/** Set while Settings is listening for a new keypress to bind, so the global shortcut handler
 * doesn't also react to that same keystroke. */
let capturing = false;
export const isCapturingKeybind = () => capturing;
export const setCapturingKeybind = (v: boolean) => {
  capturing = v;
};
