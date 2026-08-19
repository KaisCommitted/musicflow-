import type { Visualizer } from "./types";

/**
 * "None" — the animation-free option. Draws nothing, leaving just the
 * existing blurred-artwork bed and veil behind the player chrome.
 */
export const none: Visualizer = {
  id: "none",
  name: "None",
  description: "No animation — just the plain blurred artwork.",
  create() {
    return {
      draw({ ctx, w, h }) {
        ctx.clearRect(0, 0, w, h);
      },
    };
  },
};
