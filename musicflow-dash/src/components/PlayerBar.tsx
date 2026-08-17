import {
  ListMusic,
  Maximize2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import { IconSwap } from "@/components/ui/icon-swap";
import { AlbumArt } from "@/components/AlbumArt";
import { LikeButton } from "@/components/LikeButton";
import { usePlayer } from "@/store/player";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function IconButton({
  active,
  className,
  ...props
}: React.ComponentProps<typeof motion.button> & { active?: boolean }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.88 }}
      {...props}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "text-primary",
        className,
      )}
    />
  );
}

export function PlayerBar() {
  const {
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
    volume,
    muted,
    setVolume,
    toggleMute,
    queueOpen,
    setQueueOpen,
    setFullscreen,
  } = usePlayer();
  const song = usePlayer((s) => s.current());

  if (!song) return null;

  const total = duration || song.duration || 0;
  const progress = total ? Math.min(1, currentTime / total) : 0;

  return (
    <footer
      className="relative z-30 flex h-20 shrink-0 items-center gap-5 border-t border-border bg-card/95 px-5 backdrop-blur"
      style={{
        boxShadow: "0 -24px 60px -40px color-mix(in oklab, var(--dynamic) 90%, transparent)",
      }}
    >
      <div className="flex w-72 min-w-0 items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setFullscreen(true)}
          className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg glow-ring"
          aria-label="Open full-screen player"
        >
          <AlbumArt song={song} className="h-full w-full" iconClassName="h-5 w-5" size="large" />
          <span className="absolute inset-0 grid place-items-center bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-4 w-4" />
          </span>
        </motion.button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{song.title}</p>
          <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
        </div>
        <LikeButton songPath={song.path} size="sm" className="shrink-0" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          <IconButton active={shuffle} onClick={toggleShuffle} aria-label="Shuffle">
            <Shuffle className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={prev} aria-label="Previous">
            <SkipBack className="h-5 w-5" />
          </IconButton>
          <motion.button
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow"
          >
            <IconSwap id={isPlaying ? "pause" : "play"}>
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </IconSwap>
          </motion.button>
          <IconButton onClick={() => next(true)} aria-label="Next">
            <SkipForward className="h-5 w-5" />
          </IconButton>
          <IconButton
            active={repeat !== "off"}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
          >
            <IconSwap id={repeat}>
              {repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            </IconSwap>
          </IconButton>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
            {formatTime(currentTime)}
          </span>
          <Slider
            value={[progress * 100]}
            max={100}
            step={0.1}
            onValueChange={(v) => seek(((v[0] ?? 0) / 100) * total)}
            aria-label="Seek"
          />
          <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
            {formatTime(total)}
          </span>
        </div>
      </div>

      <div className="flex w-72 items-center justify-end gap-1">
        <IconButton onClick={() => setFullscreen(true)} aria-label="Lyrics">
          <Mic2 className="h-4 w-4" />
        </IconButton>
        <IconButton active={queueOpen} onClick={() => setQueueOpen(!queueOpen)} aria-label="Queue">
          <ListMusic className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={toggleMute} aria-label="Mute">
          <IconSwap id={muted || volume === 0 ? "off" : volume < 0.5 ? "low" : "high"}>
            {muted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : volume < 0.5 ? (
              <Volume1 className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </IconSwap>
        </IconButton>
        <Slider
          className="w-28"
          value={[muted ? 0 : Math.round(volume * 100)]}
          max={100}
          step={1}
          onValueChange={(v) => setVolume((v[0] ?? 0) / 100)}
          aria-label="Volume"
        />
      </div>
    </footer>
  );
}
