import { none } from "./none";
import { drift } from "./drift";
import { silk } from "./silk";
import { ember } from "./ember";
import { pulse } from "./pulse";
import type { Visualizer } from "./types";

/**
 * Registry of swappable full-screen visualizer styles, ordered calm -> energetic
 * with "None" as the off switch. The style switcher just maps over this list —
 * adding a style means dropping one file in here and appending it below.
 */
export const VISUALIZERS: Visualizer[] = [none, drift, silk, ember, pulse];

export const DEFAULT_VISUALIZER_ID = ember.id;

export const getVisualizer = (id: string): Visualizer =>
  VISUALIZERS.find((v) => v.id === id) ?? ember;

export type { Visualizer, VizFrame, VizInstance, VizPalette } from "./types";
