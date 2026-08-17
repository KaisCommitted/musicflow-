import { useEffect, useRef } from "react";
import { getAudioElement, usePlayer } from "@/store/player";
import { getAnalyser } from "@/lib/audioAnalyser";
import { cn } from "@/lib/utils";

const BAR_COUNT = 40;

/** Ambient frequency-bar strip driven by a real Web Audio AnalyserNode on the shared <audio>
 * element — only animates (rAF loop) while actually playing, and only exists while mounted
 * (the full-screen player unmounts it on close), so it costs nothing the rest of the time. */
export function AudioVisualizer({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const songId = usePlayer((s) => s.current()?.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = getAudioElement();
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !audio || !ctx2d) return;
    const node = getAnalyser(audio);
    if (!node) return;

    // Re-read per song (not per frame — getComputedStyle forces a style recalc) so the bars
    // track the per-track dynamic accent color the rest of the UI already themes around.
    const color =
      getComputedStyle(document.documentElement).getPropertyValue("--dynamic").trim() ||
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();

    const data = new Uint8Array(node.frequencyBinCount);
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { width, height } = canvas;
      node.getByteFrequencyData(data);
      ctx2d.clearRect(0, 0, width, height);
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
      const barWidth = width / BAR_COUNT;
      ctx2d.fillStyle = color;
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = data[i * step] ?? 0;
        const h = Math.max(2, (v / 255) * height);
        ctx2d.globalAlpha = 0.3 + (v / 255) * 0.7;
        ctx2d.fillRect(i * barWidth + 1, height - h, barWidth - 2, h);
      }
    };

    if (isPlaying) {
      draw();
    } else {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }

    return () => cancelAnimationFrame(raf);
  }, [isPlaying, songId]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={64}
      className={cn("h-16 w-full", className)}
      aria-hidden="true"
    />
  );
}
