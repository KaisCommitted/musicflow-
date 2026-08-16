import { useEffect, useState } from "react";
import type { Song } from "@/lib/api";
import { getLocalLyrics } from "@/lib/api";

export interface LyricLine {
  time: number;
  text: string;
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

export function useLyrics(song: Song | null, duration: number) {
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!song) {
      setLines([]);
      return;
    }
    setLoading(true);
    getLocalLyrics(song.path)
      .then((r) => {
        if (cancelled) return;
        setLines(parse(r.lyrics ?? DEMO, duration));
      })
      .catch(() => {
        if (!cancelled) setLines(parse(DEMO, duration));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // duration intentionally excluded: re-parsing on every tick would jitter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.path]);

  return { lines, loading };
}

export function activeLyricIndex(lines: LyricLine[], time: number) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.time ?? 0) <= time) idx = i;
    else break;
  }
  return idx;
}
