import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePlayer } from "@/store/player";
import { cn } from "@/lib/utils";

const PRESETS = [15, 30, 45, 60];

function Item({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
        danger && "text-destructive",
      )}
    >
      {label}
    </button>
  );
}

/** Only ticks (via setInterval) while the popover displaying it is open — the timer itself
 * runs off a single setTimeout in the store regardless, this is purely for the "~12 min left"
 * label so a closed popover isn't causing renders every second for no visible reason. */
function useMinutesLeft(endAt: number | null, live: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!endAt || !live) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [endAt, live]);
  return endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 60_000)) : 0;
}

export function SleepTimer() {
  const sleepTimerEndAt = usePlayer((s) => s.sleepTimerEndAt);
  const sleepAtTrackEnd = usePlayer((s) => s.sleepAtTrackEnd);
  const setSleepTimer = usePlayer((s) => s.setSleepTimer);
  const setSleepAtTrackEnd = usePlayer((s) => s.setSleepAtTrackEnd);
  const [open, setOpen] = useState(false);
  const minutesLeft = useMinutesLeft(sleepTimerEndAt, open);
  const active = sleepTimerEndAt != null || sleepAtTrackEnd;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Sleep timer"
          title={sleepTimerEndAt ? `Sleep timer: ~${minutesLeft} min left` : "Sleep timer"}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active && "text-primary",
          )}
        >
          <Clock className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48">
        <p className="mb-1 px-2.5 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          {sleepTimerEndAt
            ? `Stops in ~${minutesLeft} min`
            : sleepAtTrackEnd
              ? "Stops after this track"
              : "Sleep timer"}
        </p>
        {PRESETS.map((m) => (
          <Item key={m} label={`${m} minutes`} onClick={() => setSleepTimer(m)} />
        ))}
        <Item label="End of current track" onClick={() => setSleepAtTrackEnd(true)} />
        {active && (
          <>
            <div className="my-1 h-px bg-border" />
            <Item
              label="Turn off"
              danger
              onClick={() => {
                setSleepTimer(null);
                setSleepAtTrackEnd(false);
              }}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
