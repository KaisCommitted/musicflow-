import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

function bars(seed: string, count: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  let x = Math.abs(h) || 7;
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const base = (x % 1000) / 1000;
    // gentle envelope so it reads like a real waveform
    const env = 0.45 + 0.55 * Math.sin((i / count) * Math.PI);
    out.push(Math.max(0.16, base * env));
  }
  return out;
}

export function Waveform({
  seed,
  progress,
  onSeek,
  className,
  barCount = 96,
}: {
  seed: string;
  /** 0..1 */
  progress: number;
  onSeek: (ratio: number) => void;
  className?: string;
  barCount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const heights = useMemo(() => bars(seed || "musicflow", barCount), [seed, barCount]);

  const seekFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onClick={(e) => seekFromEvent(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) seekFromEvent(e.clientX);
      }}
      className={cn(
        "flex h-10 w-full cursor-pointer items-center gap-[2px] outline-none",
        className,
      )}
    >
      {heights.map((h, i) => {
        const played = i / heights.length <= progress;
        return (
          <span
            key={i}
            className="flex-1 rounded-full transition-[height,background-color,opacity] duration-200"
            style={{
              height: `${Math.round(h * 100)}%`,
              backgroundColor: played
                ? `color-mix(in oklab, var(--primary) 72%, var(--dynamic))`
                : "var(--border)",
              opacity: played ? 1 : 0.75,
            }}
          />
        );
      })}
    </div>
  );
}
