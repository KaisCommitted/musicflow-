import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { AlbumArt } from "@/components/AlbumArt";
import { Waveform } from "@/components/Waveform";
import { usePlayer } from "@/store/player";
import { activeLyricIndex, useLyrics } from "@/hooks/useLyrics";
import { formatTime } from "@/lib/format";
import { gradientFromString } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function FullScreenPlayer() {
  const {
    fullscreen,
    setFullscreen,
    isPlaying,
    toggle,
    next,
    prev,
    shuffle,
    toggleShuffle,
    repeat,
    cycleRepeat,
    currentTime,
    duration,
    seek,
  } = usePlayer();
  const song = usePlayer((s) => s.current());
  const total = duration || song?.duration || 0;
  const { lines } = useLyrics(fullscreen ? song : null, total);
  const active = activeLyricIndex(lines, currentTime);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen]);

  return (
    <AnimatePresence>
      {fullscreen && song && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="fixed inset-0 z-50 overflow-hidden"
        >
          <div className="absolute inset-0 scale-110 blur-3xl brightness-[0.35] saturate-150">
            {song.artwork ? (
              <img src={song.artwork} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="h-full w-full"
                style={{ backgroundImage: gradientFromString(song.album || song.title) }}
              />
            )}
          </div>
          <div className="absolute inset-0 bg-background/70" />

          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between px-6 py-5">
              <button
                onClick={() => setFullscreen(false)}
                aria-label="Minimize player"
                className="grid h-10 w-10 place-items-center rounded-xl bg-card/60 text-foreground backdrop-blur transition-colors hover:bg-card"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Now Playing
              </p>
              <span className="h-10 w-10" />
            </div>

            <div className="grid flex-1 grid-cols-2 gap-10 overflow-hidden px-14 pb-10">
              <div className="flex flex-col items-center justify-center gap-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={song.id}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.35 }}
                    className="glow-ring overflow-hidden rounded-3xl shadow-elevated"
                  >
                    <AlbumArt song={song} className="h-72 w-72" iconClassName="h-12 w-12" />
                  </motion.div>
                </AnimatePresence>

                <div className="w-full max-w-md text-center">
                  <h2 className="truncate text-2xl font-bold">{song.title}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {song.artist} — {song.album}
                  </p>
                  <div className="mt-6">
                    <Waveform
                      seed={song.id}
                      progress={total ? currentTime / total : 0}
                      onSeek={(r) => seek(r * total)}
                      barCount={72}
                    />
                    <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(total)}</span>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      onClick={toggleShuffle}
                      aria-label="Shuffle"
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground",
                        shuffle && "text-primary",
                      )}
                    >
                      <Shuffle className="h-4 w-4" />
                    </button>
                    <button onClick={prev} aria-label="Previous" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-card/60">
                      <SkipBack className="h-5 w-5" />
                    </button>
                    <button
                      onClick={toggle}
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform hover:scale-105"
                    >
                      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-1 h-6 w-6" />}
                    </button>
                    <button onClick={() => next(true)} aria-label="Next" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-card/60">
                      <SkipForward className="h-5 w-5" />
                    </button>
                    <button
                      onClick={cycleRepeat}
                      aria-label={`Repeat ${repeat}`}
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground",
                        repeat !== "off" && "text-primary",
                      )}
                    >
                      {repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div
                ref={listRef}
                className="overflow-y-auto py-24 [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]"
              >
                {lines.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground">No lyrics found.</p>
                ) : (
                  <div className="space-y-5 px-6">
                    {lines.map((line, i) => (
                      <motion.p
                        key={`${line.time}-${i}`}
                        data-line={i}
                        animate={{
                          opacity: i === active ? 1 : i < active ? 0.28 : 0.5,
                          scale: i === active ? 1.03 : 1,
                        }}
                        transition={{ duration: 0.3 }}
                        className={cn(
                          "origin-left text-xl leading-relaxed",
                          i === active ? "font-semibold text-primary" : "text-foreground/80",
                        )}
                      >
                        {line.text}
                      </motion.p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
