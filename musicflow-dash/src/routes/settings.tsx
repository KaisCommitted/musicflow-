import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Globe, Moon, RefreshCw, Sun } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { LibraryIssuesPanel } from "@/components/LibraryIssuesPanel";
import { useLibrary, type Settings } from "@/store/library";
import {
  backupExportUrl,
  completeLastfmAuth,
  disconnectLastfm,
  disconnectListenbrainz,
  disconnectYoutubeCookies,
  getYoutubeCookieStatus,
  importBackup,
  startLastfmAuth,
  validateListenbrainzToken,
} from "@/lib/api";
import {
  canBeGlobal,
  comboFromEvent,
  formatCombo,
  GLOBAL_ELIGIBLE_CATEGORY,
  KEYBIND_ACTIONS,
  parseGlobalKeybinds,
  parseKeybinds,
  setCapturingKeybind,
  type KeybindActionId,
  type KeybindGlobalMode,
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
  description: React.ReactNode;
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

const GLOBAL_MODES: { value: KeybindGlobalMode; label: string }[] = [
  { value: "off", label: "Not global" },
  { value: "all", label: "Global" },
  { value: "custom", label: "Custom" },
];

/** Shown next to a Playback keybind when global mode is "custom" — toggles whether that one
 * keybind also fires while Musicflow isn't focused. Disabled for combos with no modifier key,
 * since registering those system-wide would swallow that key in every other app. */
function GlobalToggle({
  combo,
  on,
  onChange,
}: {
  combo: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  const eligible = canBeGlobal(combo);
  return (
    <button
      onClick={() => eligible && onChange(!on)}
      disabled={!eligible}
      title={
        eligible
          ? on
            ? "Global — works even when Musicflow isn't focused"
            : "Make this keybind global"
          : "Needs a modifier (Ctrl / Shift / Alt) to go global — a plain key would block typing it everywhere"
      }
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
        !eligible && "cursor-not-allowed border-border opacity-30",
        eligible && on && "border-primary text-primary",
        eligible && !on && "border-border text-muted-foreground hover:border-primary/60",
      )}
    >
      <Globe className="h-3.5 w-3.5" />
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

/** The Client ID is baked into the backend (discord_rpc.py) — it identifies the Musicflow
 * app to Discord, not any one account, so there's nothing for the user to register or paste. */
function DiscordSection({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  return (
    <Row
      title="Discord Rich Presence"
      description="Show the current song as your Discord status. Requires Discord running locally."
    >
      <Toggle on={settings.discordEnabled} onChange={(v) => set("discordEnabled", v)} />
    </Row>
  );
}

/** ListenBrainz over Last.fm: a personal API token is a paste-and-go setup, where Last.fm
 * needs a registered API key/secret plus a browser-based auth flow for comparatively little
 * extra benefit — not worth the added complexity right now. */
function ScrobblingSection({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const loadSettings = useLibrary((s) => s.loadSettings);
  const [draft, setDraft] = useState(settings.listenbrainzToken);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const connected = !!settings.listenbrainzUsername;

  const verify = async () => {
    const token = draft.trim();
    if (!token) return;
    setStatus(null);
    setVerifying(true);
    try {
      const result = await validateListenbrainzToken(token);
      await loadSettings();
      setStatus(`Connected as ${result.username}.`);
    } catch {
      setStatus("That token isn't valid — check listenbrainz.org/settings and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const disconnect = async () => {
    await disconnectListenbrainz();
    setDraft("");
    setStatus(null);
    await loadSettings();
  };

  return (
    <>
      <Row
        title="ListenBrainz scrobbling"
        description="Submit listens to ListenBrainz — a song counts once you're past half its length (or 4 minutes, whichever is shorter)."
      >
        <Toggle on={settings.scrobblingEnabled} onChange={(v) => set("scrobblingEnabled", v)} />
      </Row>
      <Row
        title="ListenBrainz account"
        description={
          connected ? (
            `Connected as ${settings.listenbrainzUsername}.`
          ) : (
            <>
              Your personal token from{" "}
              <a
                href="https://listenbrainz.org/settings/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-primary"
              >
                listenbrainz.org/settings
              </a>
              . Recognition depends on how clean your artist/title tags are.
            </>
          )
        }
      >
        {connected ? (
          <button
            onClick={() => void disconnect()}
            className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
          >
            Disconnect
          </button>
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.trim())}
            onBlur={() => void verify()}
            placeholder={verifying ? "Verifying…" : "Paste your user token"}
            disabled={verifying}
            className="h-9 w-56 rounded-lg border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary disabled:opacity-60"
          />
        )}
      </Row>
      {status && <p className="px-1 text-xs text-muted-foreground">{status}</p>}
    </>
  );
}

/** Last.fm needs a one-time browser authorization per account (unlike ListenBrainz's plain
 * token) — this walks through it: open the auth page, approve it there, come back and confirm. */
function LastfmSection({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const loadSettings = useLibrary((s) => s.loadSettings);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const connected = !!settings.lastfmUsername;

  const connect = async () => {
    setStatus(null);
    try {
      const { token, url } = await startLastfmAuth();
      setPendingToken(token);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setStatus("Couldn't start Last.fm authorization.");
    }
  };

  const confirm = async () => {
    if (!pendingToken) return;
    setStatus(null);
    try {
      const result = await completeLastfmAuth(pendingToken);
      setPendingToken(null);
      await loadSettings();
      setStatus(`Connected as ${result.username}.`);
    } catch {
      setStatus("Not approved yet — finish it in the browser tab first, then try again.");
    }
  };

  const disconnect = async () => {
    await disconnectLastfm();
    await loadSettings();
  };

  return (
    <>
      <Row
        title="Last.fm scrobbling"
        description="Submit listens to Last.fm, same threshold as ListenBrainz above."
      >
        <Toggle on={settings.lastfmEnabled} onChange={(v) => set("lastfmEnabled", v)} />
      </Row>
      <Row
        title="Last.fm account"
        description={
          connected
            ? `Connected as ${settings.lastfmUsername}.`
            : pendingToken
              ? "Approve access in the browser tab that just opened, then confirm below."
              : "One-time browser authorization — Last.fm requires this for scrobbling access."
        }
      >
        <div className="flex items-center gap-2">
          {connected ? (
            <button
              onClick={() => void disconnect()}
              className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
            >
              Disconnect
            </button>
          ) : pendingToken ? (
            <button
              onClick={() => void confirm()}
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105"
            >
              I've approved it
            </button>
          ) : (
            <button
              onClick={() => void connect()}
              className="rounded-full border border-border px-4 py-2 text-xs transition-colors hover:border-primary hover:text-primary"
            >
              Connect Last.fm
            </button>
          )}
        </div>
      </Row>
      {status && <p className="px-1 text-xs text-muted-foreground">{status}</p>}
    </>
  );
}

const BROWSER_LABELS: Record<string, string> = {
  chrome: "Chrome", firefox: "Firefox", edge: "Edge", brave: "Brave", opera: "Opera",
  vivaldi: "Vivaldi", chromium: "Chromium",
};

/** Status + disconnect only — connecting happens over on the Download page, reactively, only
 * once a job actually shows signs of needing it (a run of 403s). Settings isn't where that
 * flow starts, just where you can see it's on and turn it off. */
function YoutubeSection() {
  const [status, setStatusState] = useState<{ configured: boolean; browser: string } | null>(null);

  const refresh = () => void getYoutubeCookieStatus().then(setStatusState);
  useEffect(refresh, []);

  const disconnect = async () => {
    await disconnectYoutubeCookies();
    refresh();
  };

  return (
    <Row
      title="YouTube connection"
      description={
        status?.configured
          ? `Connected via ${BROWSER_LABELS[status.browser] ?? status.browser}.`
          : "Not connected. Musicflow will offer to connect if downloads start failing the way they do when YouTube blocks anonymous requests."
      }
    >
      {status?.configured && (
        <button
          onClick={() => void disconnect()}
          className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
        >
          Disconnect
        </button>
      )}
    </Row>
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

  const globalSet = parseGlobalKeybinds(settings.globalKeybinds);
  const toggleGlobal = (actionId: KeybindActionId, on: boolean) => {
    const next = new Set(globalSet);
    if (on) next.add(actionId);
    else next.delete(actionId);
    set("globalKeybinds", JSON.stringify([...next]));
  };

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

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Discord
      </h2>
      <div className="mt-3 max-w-3xl space-y-3">
        <DiscordSection settings={settings} set={set} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        YouTube
      </h2>
      <div className="mt-3 max-w-3xl space-y-3">
        <YoutubeSection />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Scrobbling
      </h2>
      <div className="mt-3 max-w-3xl space-y-3">
        <ScrobblingSection settings={settings} set={set} />
        <LastfmSection settings={settings} set={set} />
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
        <Row
          title="Global keybinds"
          description="Let Playback keybinds work even while Musicflow isn't the focused window. Only combos with a modifier (Ctrl / Shift / Alt) are eligible — plain keys stay in-app only, so they don't block typing that key everywhere else."
        >
          <div className="flex gap-2">
            {GLOBAL_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => set("keybindGlobalMode", m.value)}
                className={cn(
                  "rounded-full border border-border px-4 py-2 text-xs transition-colors",
                  settings.keybindGlobalMode === m.value
                    ? "border-primary text-primary"
                    : "text-muted-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Row>

        {(["Playback", "Lyrics"] as const).map((category) => (
          <div key={category} className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{category}</p>
            {KEYBIND_ACTIONS.filter((a) => a.category === category).map((a) => (
              <Row key={a.id} title={a.label} description={a.description}>
                <div className="flex items-center gap-2">
                  <KeybindCapture value={keybinds[a.id]} onChange={(combo) => rebind(a.id, combo)} />
                  {settings.keybindGlobalMode === "custom" && category === GLOBAL_ELIGIBLE_CATEGORY && (
                    <GlobalToggle
                      combo={keybinds[a.id]}
                      on={globalSet.has(a.id)}
                      onChange={(v) => toggleGlobal(a.id, v)}
                    />
                  )}
                </div>
              </Row>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
