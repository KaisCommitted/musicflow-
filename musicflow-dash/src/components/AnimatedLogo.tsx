import { motion } from "framer-motion";

// Same geometry as public/brand/musicflow-mark-transparent.svg, reimplemented as JSX (rather
// than <img>-ed in) so the bars and wave can actually be animated — an <img> is a flat raster
// as far as the DOM is concerned, nothing inside it is reachable. Used by UpdateSplash for the
// "downloading / installing" full-screen takeover; every bar is centered on cy=50 in the
// source mark, which is what makes a simple height+y pulse read as a centered equalizer bar
// instead of one growing off its baseline.
const BARS = [
  { x: 20, h: 26 },
  { x: 33, h: 46 },
  { x: 46, h: 66 },
  { x: 59, h: 40 },
  { x: 72, h: 22 },
];
const CY = 50;
const BAR_SCALES = [0.55, 1, 0.65, 0.9, 0.55];
const FIRST_SCALE = BAR_SCALES[0] ?? 1;

const WAVE_A = "M14 66 C 30 30, 44 82, 58 46 C 68 22, 78 34, 86 30";
const WAVE_B = "M14 66 C 30 46, 44 66, 58 46 C 68 34, 78 46, 86 30";

export function AnimatedLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <defs>
        <linearGradient id="mf-anim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F6B267" />
          <stop offset="100%" stopColor="#F0873C" />
        </linearGradient>
      </defs>

      <motion.path
        fill="none"
        stroke="#F6B267"
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.5}
        initial={{ d: WAVE_A }}
        animate={{ d: [WAVE_A, WAVE_B, WAVE_A] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />

      {BARS.map((bar, i) => (
        <motion.rect
          key={bar.x}
          x={bar.x}
          width={8}
          rx={4}
          fill="url(#mf-anim)"
          initial={{ height: bar.h * FIRST_SCALE, y: CY - (bar.h * FIRST_SCALE) / 2 }}
          animate={{
            height: BAR_SCALES.map((s) => bar.h * s),
            y: BAR_SCALES.map((s) => CY - (bar.h * s) / 2),
          }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.1,
          }}
        />
      ))}
    </svg>
  );
}
