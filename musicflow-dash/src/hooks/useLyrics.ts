import { useEffect, useState } from "react";
import type { Song } from "@/lib/api";
import { getLyricsSources, setLyricsSource } from "@/lib/api";

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

export function useLyrics(song: Song | null, duration: number) {
  const [sources, setSources] = useState<LyricsSourceOption[]>([]);
  const [activeMethod, setActiveMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
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

  return {
    sources,
    activeMethod,
    lines: active?.lines ?? [],
    synced: active?.synced ?? false,
    loading,
    switchSource,
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
