import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Moon, RefreshCw, Sun } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { LibraryIssuesPanel } from "@/components/LibraryIssuesPanel";
import { useLibrary, type Settings } from "@/store/library";
import { backupExportUrl, importBackup } from "@/lib/api";
import {
  comboFromEvent,
  formatCombo,
  KEYBIND_ACTIONS,
  parseKeybinds,
  setCapturingKeybind,
  type KeybindActionId,
} from "@/lib/keybinds";
import { UI_SCALES, type UiScale } from "@/lib/uiScale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex h-6 w-11 shrink-0 rounded-full border border-border p-0.5 transition-colors",
        on ? "justify-end bg-primary" : "justify-start bg-muted",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 32 }}
        className="block h-4.5 w-4.5 rounded-full bg-background"
        style={{ height: 18, width: 18 }}
      />
    </button>
  );
}

/** A button that shows the current keybind and, when clicked, listens for the next keypress to
 * rebind it to (Escape cancels). Pauses the global shortcut handler while listening so the
 * captured keystroke isn't also acted on. */
function KeybindCapture({ value, onChange }: { value: string; onChange: (combo: string) => void }) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    setCapturingKeybind(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return;
      if (e.key === "Escape") {
        setListening(false);
        return;
      }
      onChange(comboFromEvent(e));
      setListening(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setCapturingKeybind(false);
    };
  }, [listening, onChange]);

  return (
    <button
      onClick={() => setListening(true)}
      className={cn(
        "min-w-[92px] rounded-lg border border-border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors",
        listening ? "border-primary text-primary" : "hover:border-primary/60",
      )}
    >
      {listening ? "Press a key…" : formatCombo(value)}
    </button>
  );
}

/** Committing on every tick resizes the slider (and everything around it, since the whole
 * app is sized in rem) mid-drag — a feedback loop that feels shaky under the cursor. So the
 * thumb/labels move instantly off local state for a responsive feel, but the actual scale
 * change (and the layout reflow that comes with it) only fires once you let go — mouse
 * release, touch end, or key up — never mid-drag, however fast or slow the drag is. */
function UiScaleSlider({ value, onChange }: { value: UiScale; onChange: (v: UiScale) => void }) {
  const [index, setIndex] = useState(() => UI_SCALES.findIndex((s) => s.value === value));
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    setIndex(UI_SCALES.findIndex((s) => s.value === value));
  }, [value]);

  const commit = () => onChange(UI_SCALES[indexRef.current]!.value);

  return (
    <div className="w-56">
      <input
        type="range"
        min={0}
        max={UI_SCALES.length - 1}
        step={1}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-full accent-[var(--color-primary)]"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {UI_SCALES.map((s, i) => (
          <span key={s.value} className={cn(i === index && "font-semibold text-primary")}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Exports/imports playlists + settings (never the audio files) as one JSON file. */
function BackupSection() {
  const refresh = useLibrary((s) => s.refresh);
  const loadSettings = useLibrary((s) => s.loadSettings);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File) => {
    setStatus(null);
    try {
      const data = JSON.parse(await file.text());
      const result = await importBackup(data);
      await Promise.all([loadSettings(), refresh()]);
      setStatus(
        result.warning ??
          `Imported ${result.imported_settings} settings and ${result.imported_playlists} playlists.`,
      );
    } catch {
      setStatus("Import failed — not a valid Musicflow backup file.");
    }
  };

  return (
    <>
      <Row
        title="Export backup"
        description="Download your playlists and settings as a JSON file."
      >
        <a
          href={backupExportUrl()}
          download
          className="rounded-full border border-border px-4 py-2 text-xs transition-colors hover:border-primary hover:text-primary"
        >
          Export
        </a>
      </Row>
      <Row
        title="Import backup"
        description="Restore playlists and settings from a backup file. Your music folder stays as-is."
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-full border border-border px-4 py-2 text-xs transition-colors hover:border-primary hover:text-primary"
        >
          Import…
        </button>
      </Row>
      {status && <p className="px-1 text-xs text-muted-foreground">{status}</p>}
    </>
  );
}

function SettingsPage() {
  const { settings, updateSettings, refresh, loading, songs } = useLibrary();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>);

  const keybinds = parseKeybinds(settings.keybinds);
  const rebind = (actionId: KeybindActionId, combo: string) => {
    const next = { ...keybinds };
    // Two actions can't share a combo — whichever one had it loses it.
    for (const id of Object.keys(next) as KeybindActionId[]) {
      if (id !== actionId && next[id] === combo) next[id] = "";
    }
    next[actionId] = combo;
    set("keybinds", JSON.stringify(next));
  };
  const resetKeybinds = () => set("keybinds", "");

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{songs.length} tracks in your library.</p>

      <div className="mt-6 max-w-3xl space-y-3">
        <Row
          title="Music folder"
          description="Scanned for MP3s and .m3u8 playlists — also where new YouTube downloads are saved."
        >
          <FolderPicker value={settings.musicFolder} onChange={(v) => set("musicFolder", v)} />
        </Row>
        <Row
          title="Rescan library"
          description="Re-read tags and playlists from disk. Also checks for duplicate downloads and files that fail to play."
        >
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
          </button>
        </Row>
        <LibraryIssuesPanel />

        <Row title="Theme" description="Dark is the default Musicflow look.">
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                onClick={() => set("theme", t)}
                className={cn(
                  "flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs capitalize transition-colors",
                  settings.theme === t ? "border-primary text-primary" : "text-muted-foreground",
                )}
              >
                {t === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                {t}
              </button>
            ))}
          </div>
        </Row>

        <Row title="UI size" description="Scales text and UI elements throughout the app.">
          <UiScaleSlider value={settings.uiScale} onChange={(v) => set("uiScale", v)} />
        </Row>

        <Row title="Crossfade" description={`${settings.crossfade}s fade between tracks.`}>
          <input
            type="range"
            min={0}
            max={12}
            value={settings.crossfade}
            onChange={(e) => set("crossfade", Number(e.target.value))}
            className="w-48 accent-[var(--color-primary)]"
          />
        </Row>

        <Row title="Playlist tags" description="Show playlist badges next to songs.">
          <Toggle on={settings.showPlaylistTags} onChange={(v) => set("showPlaylistTags", v)} />
        </Row>
        <Row title="Scan on start" description="Refresh the library when Musicflow opens.">
          <Toggle on={settings.autoScanOnStart} onChange={(v) => set("autoScanOnStart", v)} />
        </Row>
        <Row title="Gapless playback" description="Preload the next track for seamless play.">
          <Toggle on={settings.gaplessPlayback} onChange={(v) => set("gaplessPlayback", v)} />
        </Row>
        <Row title="Automatic lyrics" description="Fetch lyrics when a song starts.">
          <Toggle
            on={settings.fetchLyricsAutomatically}
            onChange={(v) => set("fetchLyricsAutomatically", v)}
          />
        </Row>
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Backup
      </h2>
      <div className="mt-3 max-w-3xl space-y-3">
        <BackupSection />
      </div>

      <div className="mt-8 flex max-w-3xl items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Keybinds
        </h2>
        <button
          onClick={resetKeybinds}
          className="text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          Reset to defaults
        </button>
      </div>
      <div className="mt-3 max-w-3xl space-y-3">
        {(["Playback", "Lyrics"] as const).map((category) => (
          <div key={category} className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{category}</p>
            {KEYBIND_ACTIONS.filter((a) => a.category === category).map((a) => (
              <Row key={a.id} title={a.label} description={a.description}>
                <KeybindCapture value={keybinds[a.id]} onChange={(combo) => rebind(a.id, combo)} />
              </Row>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
