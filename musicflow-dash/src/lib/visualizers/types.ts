import type { AudioFeatures } from "@/lib/audio/features";

export type RGB = [number, number, number];

export type VizPalette = {
  accent: RGB;
  accent2: RGB;
  ink: RGB;
  isDark: boolean;
};

export type VizFrame = {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size (context is already DPR-scaled) */
  w: number;
  h: number;
  /** seconds since last frame, clamped */
  dt: number;
  f: AudioFeatures;
  palette: VizPalette;
};

export type VizInstance = {
  draw(frame: VizFrame): void;
  /** called on resize so instances can rebuild cached geometry */
  resize?(w: number, h: number): void;
};

export type Visualizer = {
  id: string;
  name: string;
  description: string;
  create(): VizInstance;
};

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
