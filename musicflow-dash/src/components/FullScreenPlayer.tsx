import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ALargeSmall,
  Check,
  ChevronDown,
  Maximize,
  Mic2,
  Minimize,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AlbumArt } from "@/components/AlbumArt";
import { Waveform } from "@/components/Waveform";
import { LikeButton } from "@/components/LikeButton";
import { VisualizerStage } from "@/components/VisualizerStage";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { IconSwap } from "@/components/ui/icon-swap";
import { usePlayer } from "@/store/player";
import { activeLyricIndex, useLyrics } from "@/hooks/useLyrics";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useFullscreenChrome } from "@/hooks/useFullscreenChrome";
import { formatTime } from "@/lib/format";
import { gradientFromString } from "@/lib/colors";
import { lyricsSourceLabel } from "@/lib/lyricsSources";
import { VISUALIZERS, DEFAULT_VISUALIZER_ID } from "@/lib/visualizers";
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
    setLyricsSynced,
    volume,
    muted,
    setVolume,
    toggleMute,
  } = usePlayer();
  const song = usePlayer((s) => s.current());
  const total = duration || song?.duration || 0;
  const { sources, activeMethod, lines, synced, switchSource, shiftOffset, sessionShift } =
    useLyrics(fullscreen ? song : null, total);
  const active = activeLyricIndex(lines, currentTime);
  const listRef = useRef<HTMLDivElement>(null);
  const realSources = sources.filter((s) => s.method !== "demo");
  // "normal" is the existing scrolling list; "big" shows the current line (plus neighbours,
  // all still in the list) at a larger size; "huge" shows only three lines total — the
  // previous and next lines greyed out, nothing else. Cycles normal -> big -> huge -> normal.
  // Sticky for the session, not persisted.
  const [lyricsMode, setLyricsMode] = useState<"normal" | "big" | "huge">("normal");
  const isBigMode = synced && lyricsMode === "big";
  const isHugeMode = synced && lyricsMode === "huge";
  const cycleLyricsMode = () =>
    setLyricsMode((m) => (m === "normal" ? "big" : m === "big" ? "huge" : "normal"));
  // Mouse-idle tracking runs whenever the immersive view itself is open at all (windowed or
  // real fullscreen) — see useFullscreenChrome for how the header vs. the lyrics
  // controls/style switcher each turn that into a different visibility rule below.
  const { docFullscreen, mouseIdle } = useFullscreenChrome(fullscreen);
  const mouseActive = !mouseIdle;
  // The header (minimize / enter-exit-fullscreen): idle-reveals in the normal windowed
  // immersive view, but never shows at all in real fullscreen — only actually exiting real
  // fullscreen (Escape) brings it back.
  const showHeader = !docFullscreen && mouseActive;
  // Lyrics controls (+5s/-5s, source switcher, Aa) and the style switcher: idle-reveal the
  // same way in both the windowed view and real fullscreen.
  const showChrome = mouseActive;
  // Which full-screen background visualizer is active. Sticky for the session, not persisted —
  // same convention as lyricsMode above.
  const [styleId, setStyleId] = useState(DEFAULT_VISUALIZER_ID);
  const featuresRef = useAudioFeatures(fullscreen);
  // The style switcher is otherwise hover-only — this keeps it visible for a while after an
  // actual interaction (picking a style, or opening it by clicking the trigger) so it doesn't
  // vanish the instant the pointer drifts off, then falls back to pure hover.
  const [switcherPinned, setSwitcherPinned] = useState(false);
  const switcherPinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinSwitcher = () => {
    setSwitcherPinned(true);
    if (switcherPinTimeout.current) clearTimeout(switcherPinTimeout.current);
    switcherPinTimeout.current = setTimeout(() => setSwitcherPinned(false), 20_000);
  };
  useEffect(() => () => {
    if (switcherPinTimeout.current) clearTimeout(switcherPinTimeout.current);
  }, []);
  // The switcher idle-fades with the rest of the lyrics/style chrome in real fullscreen (see
  // showChrome below) — drop any pin along with it, so a still-pinned chip row from a moment
  // ago can't stay silently clickable underneath the now-invisible wrapper.
  useEffect(() => {
    if (!showChrome) setSwitcherPinned(false);
  }, [showChrome]);

  useEffect(() => {
    setLyricsSynced(synced);
  }, [synced, setLyricsSynced]);

  // Exiting the immersive view (minimize, Escape, etc.) should also drop real fullscreen —
  // otherwise the browser/OS chrome stays hidden with nothing immersive left to show for it.
  useEffect(() => {
    if (!fullscreen && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [fullscreen]);

  const toggleDocFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const container = listRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!container || !el) return;
    // Scroll the lyrics container directly by the exact pixel delta, rather than
    // el.scrollIntoView() — that API can walk up and scroll *any* scrollable ancestor (or the
    // page itself) to satisfy the request, which is what was lifting the whole full-screen view.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top + elRect.height / 2 - (containerRect.top + containerRect.height / 2);
    container.scrollBy({ top: delta, behavior: "smooth" });
    // lyricsMode is included so switching modes re-centers immediately — big mode's lines are a
    // different size, so the old scroll position no longer centers the active line correctly.
  }, [active, lyricsMode]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Real fullscreen already exits itself on Escape natively — let that happen first and
        // only minimize the immersive view on a second press.
        if (document.fullscreenElement) return;
        setFullscreen(false);
      }
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
          // Always edge-to-edge (top-0) — the title bar (TitleBar.tsx, h-9) no longer paints its
          // own background once this is open (see its `showBar`), so this covers that space
          // too instead of leaving a dead strip of plain background behind it. The content
          // itself still leaves room there — see the pt-9 below — this is just the background
          // (art/visualizer/veil).
          className="fixed inset-x-0 bottom-0 top-0 z-50 overflow-hidden"
        >
          {/* Fully opaque backstop — the blurred bed's blur can leave faint edge fringing, and
              the veil below is a partial-alpha gradient by design (it's meant to let colour
              breathe through near the centre), so neither one alone guarantees full coverage.
              Without this, the mini player and whatever else sits behind in the DOM was
              faintly visible through the edges/corners. */}
          <div className="absolute inset-0 bg-background" />
          <div className="absolute inset-0 scale-110 blur-3xl brightness-[var(--stage-bed-brightness)] saturate-150">
            {song.artwork ? (
              <img src={song.artwork} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="h-full w-full"
                style={{ backgroundImage: gradientFromString(song.album || song.title) }}
              />
            )}
          </div>
          <VisualizerStage featuresRef={featuresRef} styleId={styleId} />
          <div className="pointer-events-none absolute inset-0 bg-[image:var(--stage-veil)]" />

          <div className={cn("relative flex h-full flex-col", !docFullscreen && "pt-9")}>
            {/* Idle-reveals on mouse movement in the normal windowed view; in real fullscreen
                it never reappears that way at all, only on actually exiting it (Escape) — see
                showHeader above. Collapses its actual height (not just opacity) when hidden, so
                the grid below reflows to fill the reclaimed space instead of leaving a blank
                gap — flex-1 on that grid does the rest once this row is actually gone. */}
            <AnimatePresence initial={false}>
              {showHeader && (
                <motion.div
                  key="header"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center justify-between px-6 py-5">
                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9, y: 2 }}
                      onClick={() => setFullscreen(false)}
                      aria-label="Minimize player"
                      className="grid h-10 w-10 place-items-center rounded-xl bg-card/60 text-foreground backdrop-blur transition-colors hover:bg-card"
                    >
                      <ChevronDown className="h-5 w-5" />
                    </motion.button>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Now Playing
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9, y: 2 }}
                      onClick={toggleDocFullscreen}
                      aria-label={docFullscreen ? "Exit full screen" : "Enter full screen"}
                      className="grid h-10 w-10 place-items-center rounded-xl bg-card/60 text-foreground backdrop-blur transition-colors hover:bg-card"
                    >
                      <IconSwap id={docFullscreen ? "exit-fs" : "enter-fs"}>
                        {docFullscreen ? (
                          <Minimize className="h-5 w-5" />
                        ) : (
                          <Maximize className="h-5 w-5" />
                        )}
                      </IconSwap>
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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
                    <AlbumArt
                      song={song}
                      className="h-72 w-72"
                      iconClassName="h-12 w-12"
                      size="large"
                    />
                  </motion.div>
                </AnimatePresence>

                <div className="w-full max-w-md text-center">
                  <div className="flex items-center justify-center gap-2">
                    <h2 className="min-w-0 truncate text-2xl font-bold">{song.title}</h2>
                    <LikeButton songPath={song.path} size="sm" className="shrink-0" />
                  </div>
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
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={toggleShuffle}
                      aria-label="Shuffle"
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground",
                        shuffle && "text-primary",
                      )}
                    >
                      <Shuffle className="h-4 w-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={prev}
                      aria-label="Previous"
                      className="grid h-11 w-11 place-items-center rounded-xl hover:bg-card/60"
                    >
                      <SkipBack className="h-5 w-5" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={toggle}
                      aria-label={isPlaying ? "Pause" : "Play"}
                      className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow"
                    >
                      <IconSwap id={isPlaying ? "pause" : "play"}>
                        {isPlaying ? (
                          <Pause className="h-6 w-6" />
                        ) : (
                          <Play className="ml-1 h-6 w-6" />
                        )}
                      </IconSwap>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={() => next(true)}
                      aria-label="Next"
                      className="grid h-11 w-11 place-items-center rounded-xl hover:bg-card/60"
                    >
                      <SkipForward className="h-5 w-5" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={cycleRepeat}
                      aria-label={`Repeat ${repeat}`}
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground",
                        repeat !== "off" && "text-primary",
                      )}
                    >
                      <IconSwap id={repeat}>
                        {repeat === "one" ? (
                          <Repeat1 className="h-4 w-4" />
                        ) : (
                          <Repeat className="h-4 w-4" />
                        )}
                      </IconSwap>
                    </motion.button>
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={toggleMute}
                      aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
                    >
                      <IconSwap id={muted || volume === 0 ? "off" : volume < 0.5 ? "low" : "high"}>
                        {muted || volume === 0 ? (
                          <VolumeX className="h-4 w-4" />
                        ) : volume < 0.5 ? (
                          <Volume1 className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </IconSwap>
                    </motion.button>
                    <Slider
                      className="w-32"
                      value={[muted ? 0 : Math.round(volume * 100)]}
                      max={100}
                      step={1}
                      onValueChange={(v) => setVolume((v[0] ?? 0) / 100)}
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                {lines.length > 0 && (
                  <div
                    className={cn(
                      "mb-2 flex items-center justify-between gap-3 px-6 transition-opacity duration-300",
                      showChrome ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          synced ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {synced ? "Synced" : "Plain"}
                      </span>
                      {realSources.length > 1 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              aria-label="Switch lyrics source"
                              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
                            >
                              <Mic2 className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-56">
                            {sources.map((s) => (
                              <button
                                key={s.method}
                                onClick={() => switchSource(s.method)}
                                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                              >
                                <span className="flex items-center gap-2">
                                  <Check
                                    className={cn(
                                      "h-3 w-3 text-primary",
                                      s.method !== activeMethod && "invisible",
                                    )}
                                  />
                                  {lyricsSourceLabel(s.method)}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] font-semibold uppercase",
                                    s.synced ? "text-success" : "text-muted-foreground",
                                  )}
                                >
                                  {s.synced ? "Synced" : "Plain"}
                                </span>
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>
                      )}
                      {synced && (
                        <button
                          onClick={cycleLyricsMode}
                          aria-label={`Lyrics view: ${lyricsMode} (click to cycle)`}
                          title="Cycle lyrics size — normal, big, huge"
                          className={cn(
                            "grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground",
                            lyricsMode !== "normal" && "bg-card/60 text-primary",
                          )}
                        >
                          <ALargeSmall className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {synced && (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {sessionShift !== 0 && (
                          <span className="tabular-nums text-primary">
                            {sessionShift > 0 ? "+" : ""}
                            {sessionShift.toFixed(1)}s this session
                          </span>
                        )}
                        <button
                          onClick={() => shiftOffset(-5)}
                          aria-label="Shift lyrics timing 5 seconds earlier"
                          title="Corrects the saved lyrics file — not a temporary display shift"
                          className="rounded-md border border-border px-2 py-0.5 transition-colors hover:border-primary hover:text-primary"
                        >
                          −5s
                        </button>
                        <button
                          onClick={() => shiftOffset(5)}
                          aria-label="Shift lyrics timing 5 seconds later"
                          title="Corrects the saved lyrics file — not a temporary display shift"
                          className="rounded-md border border-border px-2 py-0.5 transition-colors hover:border-primary hover:text-primary"
                        >
                          +5s
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div
                  ref={listRef}
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto py-24 [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]",
                    // Scrolling still works — this only hides the visible scrollbar track/thumb,
                    // which has no place in an otherwise-chromeless immersive view.
                    docFullscreen && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  )}
                >
                  {lines.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground">No lyrics found.</p>
                  ) : !synced ? (
                    // No timing data — just show the text, plainly, with no highlighting or scroll-tracking.
                    <div className="space-y-3 px-6 text-lg leading-relaxed text-foreground/80">
                      {lines.map((line, i) => (
                        <p key={i}>{line.text}</p>
                      ))}
                    </div>
                  ) : isHugeMode ? (
                    // Only ever three lines exist here at all — previous and next greyed out,
                    // everything else genuinely not rendered (not just faded), unlike "big"
                    // mode which keeps the whole list mounted underneath. Never needs to
                    // scroll, so it just centers in the same container rather than getting a
                    // layout of its own.
                    <div className="flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={`prev-${active}`}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 0.4, y: 0 }}
                          exit={{ opacity: 0, y: -12 }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                          className="text-2xl leading-relaxed text-foreground/70"
                        >
                          {lines[active - 1]?.text ?? " "}
                        </motion.p>
                      </AnimatePresence>
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={`current-${active}`}
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.92 }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                          className="text-6xl font-bold leading-tight text-primary"
                        >
                          {lines[active]?.text ?? " "}
                        </motion.p>
                      </AnimatePresence>
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={`next-${active}`}
                          initial={{ opacity: 0, y: -12 }}
                          animate={{ opacity: 0.4, y: 0 }}
                          exit={{ opacity: 0, y: 12 }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                          className="text-2xl leading-relaxed text-foreground/70"
                        >
                          {lines[active + 1]?.text ?? " "}
                        </motion.p>
                      </AnimatePresence>
                    </div>
                  ) : (
                    // Every line stays mounted the whole time — only its opacity/scale animate as
                    // `active` moves. That's what makes this smooth: Framer tweens the existing
                    // element to new target values instead of a key change unmounting one line and
                    // mounting the next, which is what was causing the flicker/blank-gap in big mode.
                    <div className={cn(isBigMode ? "space-y-8 px-10 text-center" : "space-y-5 px-6")}>
                      {lines.map((line, i) => {
                        const dist = Math.abs(i - active);
                        return (
                          <motion.p
                            key={`${line.time}-${i}`}
                            data-line={i}
                            animate={
                              isBigMode
                                ? {
                                    opacity: dist === 0 ? 1 : dist === 1 ? 0.45 : 0.08,
                                    scale: dist === 0 ? 1.15 : dist === 1 ? 0.85 : 0.7,
                                  }
                                : {
                                    opacity: i === active ? 1 : i < active ? 0.28 : 0.5,
                                    scale: i === active ? 1.03 : 1,
                                  }
                            }
                            transition={{ duration: 0.4, ease: "easeOut" }}
                            className={cn(
                              "leading-relaxed",
                              isBigMode ? "origin-center text-3xl" : "origin-left text-xl",
                              i === active ? "font-semibold text-primary" : "text-foreground/80",
                            )}
                          >
                            {line.text}
                          </motion.p>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Hidden until hovered — an immersive view shouldn't have a permanent row of
                chips sitting on it. The trigger is the only hoverable/clickable part until
                revealed; the wrapper and (initially) the chip row itself pass clicks straight
                through to whatever's behind them. Clicking the trigger or a style pins it open
                for 20s (switcherPinned) so it doesn't vanish mid-decision the moment the
                pointer drifts off — after that it drops back to pure hover. On top of that,
                same as the lyrics controls (not the title bar/header — those never come back
                until you actually exit real fullscreen), the whole thing also idle-fades in
                real fullscreen so it's reachable there too, just not permanently on screen. */}
            <div
              className={cn(
                "group/style pointer-events-none absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-3 transition-opacity duration-300",
                showChrome ? "opacity-100" : "opacity-0",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none flex origin-bottom items-center gap-1 rounded-full bg-card/70 p-1.5 shadow-elevated backdrop-blur transition-all duration-200 group-hover/style:pointer-events-auto group-hover/style:scale-100 group-hover/style:opacity-100",
                  switcherPinned
                    ? "pointer-events-auto scale-100 opacity-100"
                    : "scale-95 opacity-0",
                )}
              >
                {VISUALIZERS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setStyleId(v.id);
                      pinSwitcher();
                    }}
                    title={v.description}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground",
                      styleId === v.id &&
                        "bg-primary text-primary-foreground hover:text-primary-foreground",
                    )}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
              <button
                onClick={pinSwitcher}
                aria-label="Change visualizer style"
                title="Visualizer style"
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full bg-card/60 text-muted-foreground backdrop-blur transition-colors hover:bg-card hover:text-foreground",
                  showChrome ? "pointer-events-auto" : "pointer-events-none",
                )}
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
