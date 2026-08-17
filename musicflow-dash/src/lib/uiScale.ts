/** Global text/UI size. Tailwind's spacing and font-size scales are rem-based, so
 * changing the root font-size scales the whole app (text, icons, padding, gaps) —
 * not just text. */
export type UiScale = "tiny" | "small" | "medium" | "big" | "huge";

export const UI_SCALES: { value: UiScale; label: string; rootFontSize: string }[] = [
  { value: "tiny", label: "Tiny", rootFontSize: "14px" },
  { value: "small", label: "Small", rootFontSize: "16px" },
  { value: "medium", label: "Medium", rootFontSize: "18px" },
  { value: "big", label: "Big", rootFontSize: "20px" },
  { value: "huge", label: "Huge", rootFontSize: "22px" },
];

export function isUiScale(v: string): v is UiScale {
  return UI_SCALES.some((s) => s.value === v);
}

export function applyUiScale(scale: UiScale) {
  if (typeof document === "undefined") return;
  const entry = UI_SCALES.find((s) => s.value === scale) ?? UI_SCALES[1]!;
  document.documentElement.style.fontSize = entry.rootFontSize;
}
