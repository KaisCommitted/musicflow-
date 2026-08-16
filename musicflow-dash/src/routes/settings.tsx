import { createFileRoute } from "@tanstack/react-router";
import { Moon, RefreshCw, Sun } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { useLibrary, type Settings } from "@/store/library";
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
        "h-6 w-11 shrink-0 rounded-full border border-border p-0.5 transition-colors",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "block h-4.5 w-4.5 rounded-full bg-background transition-transform",
          on ? "translate-x-5" : "translate-x-0",
        )}
        style={{ height: 18, width: 18 }}
      />
    </button>
  );
}

function SettingsPage() {
  const { settings, updateSettings, refresh, loading, songs } = useLibrary();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>);

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{songs.length} tracks in your library.</p>

      <div className="mt-6 max-w-3xl space-y-3">
        <Row title="Music folder" description="Scanned for MP3s and .m3u8 playlists — also where new YouTube downloads are saved.">
          <FolderPicker
            value={settings.musicFolder}
            onChange={(v) => set("musicFolder", v)}
          />
        </Row>
        <Row title="Rescan library" description="Re-read tags and playlists from disk.">
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
          </button>
        </Row>

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
    </div>
  );
}
