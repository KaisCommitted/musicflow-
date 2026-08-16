import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/api";
import { getLyricsSources, setLyricsSource, shiftLyricsOffset } from "@/lib/api";

export interface LyricLine {
  time: number;
  text: string;
}

interface LyricsSourceOption {
  method: string;
  synced: boolean;
  lines: LyricLine[];
}

const DEMO = `In the low light of a borrowed room
Every echo learns your name
Static bloom on the radio
We were never quite the same
Hold the line, hold the line
Let the chorus carry through
Neon freeway, engine hum
Every mile is pointed back to you`;

function parse(raw: string, duration: number): LyricLine[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  const timed: LyricLine[] = [];
  const re = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]\s*(.*)$/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const time =
        Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / (m[3].length === 1 ? 10 : 100) : 0);
      timed.push({ time, text: (m[4] ?? "").trim() });
    }
  }
  if (timed.length) return timed;
  // No LRC timings — spread plain lines across the track for a synced feel.
  const span = duration > 0 ? duration : lines.length * 4;
  const step = span / (lines.length + 1);
  return lines.map((text, i) => ({ time: step * (i + 1), text: text.trim() }));
}

const DEMO_METHOD = "demo";

// Bridges the currently-mounted FullScreenPlayer's shiftOffset to the global keyboard shortcut
// handler (which has no other way to reach into it). Re-registered on every render (see the
// effect below with no dep array) so it always calls the current song/source's closure.
let activeShiftHandler: ((delta: number) => void) | null = null;

/** Nudges whichever song's synced lyrics are currently shown in the full-screen player, if any. */
export function shiftActiveLyrics(delta: number) {
  activeShiftHandler?.(delta);
}

export function useLyrics(song: Song | null, duration: number) {
  const [sources, setSources] = useState<LyricsSourceOption[]>([]);
  const [activeMethod, setActiveMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // How much each source has been nudged this sitting, per method — not read from the file (it
  // only stores absolute corrected timestamps, no delta), so this is purely a this-session
  // display. Cleared whenever the song changes, which is also what makes it disappear.
  const [sessionShift, setSessionShift] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setSessionShift({});
    if (!song) {
      setSources([]);
      setActiveMethod(null);
      return;
    }
    setLoading(true);
    getLyricsSources(song.path)
      .then((r) => {
        if (cancelled) return;
        if (r.sources.length === 0) {
          setSources([{ method: DEMO_METHOD, synced: false, lines: parse(DEMO, duration) }]);
          setActiveMethod(DEMO_METHOD);
          return;
        }
        setSources(
          r.sources.map((s) => ({ method: s.method, synced: s.synced, lines: parse(s.text, duration) })),
        );
        setActiveMethod(r.sources.find((s) => s.active)?.method ?? r.sources[0]!.method);
      })
      .catch(() => {
        if (cancelled) return;
        setSources([{ method: DEMO_METHOD, synced: false, lines: parse(DEMO, duration) }]);
        setActiveMethod(DEMO_METHOD);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // duration intentionally excluded: re-parsing on every tick would jitter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.path]);

  const active = sources.find((s) => s.method === activeMethod) ?? null;

  const switchSource = (method: string) => {
    if (!song || method === DEMO_METHOD || method === activeMethod) return;
    setActiveMethod(method); // optimistic — the UI already knows this source's text
    void setLyricsSource(song.path, method).catch(() => undefined);
  };

  // Chained (not parallel) so an accelerated run of nudges can't race and interleave
  // read-modify-write cycles on the same backup file — each call waits for the previous one's
  // round trip before firing the next.
  const shiftChain = useRef<Promise<unknown>>(Promise.resolve());

  const shiftOffset = (delta: number) => {
    if (!song || !activeMethod || activeMethod === DEMO_METHOD) return;
    const path = song.path;
    const method = activeMethod;
    // Instant visual feedback — shift the currently rendered lines immediately; the response
    // below re-syncs from the server's actual (rounded/clamped) result once it lands.
    setSources((prev) =>
      prev.map((s) =>
        s.method === method
          ? { ...s, lines: s.lines.map((l) => ({ ...l, time: Math.max(0, l.time + delta) })) }
          : s,
      ),
    );
    setSessionShift((prev) => ({
      ...prev,
      [method]: Math.round(((prev[method] ?? 0) + delta) * 10) / 10,
    }));
    shiftChain.current = shiftChain.current
      .then(() => shiftLyricsOffset(path, method, delta))
      .then((r) => {
        setSources((prev) =>
          prev.map((s) => (s.method === method ? { ...s, lines: parse(r.lyrics, duration) } : s)),
        );
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    activeShiftHandler = active?.synced ? shiftOffset : null;
    return () => {
      activeShiftHandler = null;
    };
  }); // no dep array — always re-registers the current render's closure (song/activeMethod may
  // have changed without `synced` itself changing, e.g. switching between two synced sources)

  return {
    sources,
    activeMethod,
    lines: active?.lines ?? [],
    synced: active?.synced ?? false,
    loading,
    switchSource,
    shiftOffset,
    /** How much the active source has been nudged this sitting; 0 once untouched or on a new song. */
    sessionShift: (activeMethod && sessionShift[activeMethod]) || 0,
  };
}

export function activeLyricIndex(lines: LyricLine[], time: number) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.time ?? 0) <= time) idx = i;
    else break;
  }
  return idx;
}
