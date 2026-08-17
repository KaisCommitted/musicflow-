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

/** Set while Settings is listening for a new keypress to bind, so the global shortcut handler
 * doesn't also react to that same keystroke. */
let capturing = false;
export const isCapturingKeybind = () => capturing;
export const setCapturingKeybind = (v: boolean) => {
  capturing = v;
};
