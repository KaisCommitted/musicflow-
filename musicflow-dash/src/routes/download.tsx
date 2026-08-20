import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  ListMusic,
  Loader2,
  LogIn,
  Music2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  ARTWORK_SIZES,
  getHistory,
  getHistoryDetail,
  jobArtworkUrl,
  openYoutubeInBrowser,
  resolveSpotifyPlaylists,
  resolveYoutubePlaylists,
  retryHistoryItem,
  scanYoutubeCookieBrowsers,
  setupYoutubeCookies,
  withArtworkSize,
  type HistoryDetail,
  type HistoryJobSummary,
  type SpotifyResolvedPlaylist,
  type YoutubeResolvedPlaylist,
} from "@/lib/api";
import { useDownload } from "@/store/download";
import { usePlayer } from "@/store/player";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const Route = createFileRoute("/download")({
  component: DownloadPage,
});

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  searching: { label: "Searching", className: "text-warning" },
  downloading: { label: "Downloading", className: "text-primary" },
  done: { label: "Done", className: "text-success" },
  skipped: { label: "Skipped", className: "text-muted-foreground" },
  error: { label: "Error", className: "text-destructive" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  if (status === "skipped") return <SkipForward className="h-4 w-4 text-muted-foreground" />;
  if (status === "downloading") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return <span className="h-2 w-2 rounded-full bg-muted-foreground" />;
}

const BROWSER_LABELS: Record<string, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  edge: "Edge",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  chromium: "Chromium",
};

function joinBrowserNames(browsers: string[]): string {
  const labels = browsers.map((b) => BROWSER_LABELS[b] ?? b);
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Dismissing the "reconnect YouTube" card doesn't get persisted to the backend on purpose — it
// should still come back if it's needed again later (a fresh job hitting the same 403 wall),
// just not stick around for the rest of this one once someone's said "not now".
const YOUTUBE_CARD_DISMISS_KEY = "musicflow:youtube-login-dismissed";

/** Native <select> can't render an icon inside its own options — this is the whole reason
 * BrowserPicker exists instead of a plain dropdown. Icons from alrra/browser-logos (MIT),
 * copied into public/browser-icons/ once rather than pulled from a CDN at runtime, matching
 * every other asset here being fully offline-capable once installed. */
function BrowserPicker({
  browsers,
  value,
  onChange,
}: {
  browsers: string[];
  value: string;
  onChange: (browser: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm outline-none transition-colors hover:border-primary/60 focus:border-primary">
          {value && <img src={`/browser-icons/${value}.svg`} alt="" className="h-4 w-4" />}
          {BROWSER_LABELS[value] ?? value}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40">
        {browsers.map((b) => (
          <button
            key={b}
            onClick={() => {
              onChange(b);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
              b === value && "text-primary",
            )}
          >
            <img src={`/browser-icons/${b}.svg`} alt="" className="h-4 w-4" />
            {BROWSER_LABELS[b] ?? b}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** YouTube increasingly blocks anonymous downloads outright ("Sign in to confirm you're not a
 * bot"), which shows up as every remaining item in a job failing with a 403 after retries —
 * that specific pattern (server.py's "likely blocked" signal) is the only thing that shows
 * this card. Deliberately not shown proactively (e.g. before a first download, or just because
 * no login is connected yet) — plenty of downloads succeed anonymously, so offering a login
 * before there's any actual sign it's needed would be a solution looking for a problem.
 * Disconnecting a working connection lives in Settings, not here. */
function YoutubeLoginCard() {
  const [scanning, setScanning] = useState(true);
  const [browsers, setBrowsers] = useState<string[]>([]);
  const [locked, setLocked] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [browser, setBrowser] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(YOUTUBE_CARD_DISMISS_KEY) === "1",
  );

  useEffect(() => {
    void scanYoutubeCookieBrowsers()
      .then((r) => {
        setBrowsers(r.browsers);
        setLocked(r.locked);
        setBlocked(r.blocked);
        setBrowser(r.browsers[0] ?? "");
      })
      .finally(() => setScanning(false));
  }, []);

  const connectTo = async (b: string, closeFirst: boolean) => {
    if (!b) return;
    setError(null);
    setConnecting(true);
    try {
      await setupYoutubeCookies(b, closeFirst);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    } finally {
      setConnecting(false);
    }
  };
  const connect = () => connectTo(browser, false);

  const openInBrowser = async () => {
    if (!browser) return;
    setOpening(true);
    try {
      await openYoutubeInBrowser(browser);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the browser.");
    } finally {
      setOpening(false);
    }
  };

  if (dismissed || connected) return null;

  // Nothing usable, but we didn't just "not find" these — something stopped us from even
  // checking, which needs its own explanation. Neither can offer a picker: there's nothing to
  // pick, only something to explain. Locked wins when both are present since it's the
  // actionable one (closing the browser costs nothing and might just fix it).
  const noneUsable = !scanning && browsers.length === 0;
  const explainLocked = noneUsable && locked.length > 0;
  const explainBlocked = noneUsable && !explainLocked && blocked.length > 0;

  return (
    <div className="surface flex flex-wrap items-center gap-4 px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <LogIn className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Your YouTube connection may have expired</p>
        <p className="text-xs text-muted-foreground">
          {scanning
            ? "Checking your browsers for a YouTube login…"
            : explainLocked
              ? `${joinBrowserNames(locked)} ${locked.length > 1 ? "are" : "is"} open right now, which stops us from even checking ${locked.length > 1 ? "them" : "it"} for a YouTube login — closing ${locked.length > 1 ? "them" : "it"} usually fixes this.`
              : explainBlocked
                ? `${joinBrowserNames(blocked)} ${blocked.length > 1 ? "block" : "blocks"} outside apps from reading its saved cookies — a security feature every Chromium-based browser has had since mid-2024, not something we can fix. Firefox doesn't have this restriction, or skip this — downloads still work without it, just less reliably.`
                : browsers.length === 0
                  ? "No YouTube login found in any installed browser — sign in to YouTube in one of them, then try again."
                  : "Downloads are failing the way they do when YouTube is blocking anonymous requests — reconnecting usually fixes it."}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {scanning ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : browsers.length > 0 ? (
          <>
            <BrowserPicker browsers={browsers} value={browser} onChange={setBrowser} />
            {/* Cookies always come from whichever Google account is currently active in this
             * browser — with more than one signed in there, this is the only reliable way to
             * see (or switch, via YouTube's own avatar menu) which one that is before
             * connecting, since Musicflow can't pick a different one on its own. */}
            <button
              onClick={() => void openInBrowser()}
              disabled={opening}
              title={`Open YouTube in ${BROWSER_LABELS[browser] ?? browser} to check which account is active`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-40"
            >
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        ) : null}
        {(scanning || browsers.length > 0) && (
          <button
            onClick={() => void connect()}
            disabled={connecting || !browser || scanning}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105 disabled:opacity-40"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
        {/* Only for a browser we know is just *open* (locked), never for one that's DPAPI-
         * blocked — closing it wouldn't change anything there. A distinct, explicitly-labeled
         * button rather than folding this into "Connect" everywhere, since closing someone's
         * browser is disruptive enough that clicking it should be its own clear choice. */}
        {explainLocked &&
          locked.map((b) => (
            <button
              key={b}
              onClick={() => void connectTo(b, true)}
              disabled={connecting}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105 disabled:opacity-40"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <img src={`/browser-icons/${b}.svg`} alt="" className="h-3.5 w-3.5" />
              )}
              {connecting ? "Connecting…" : `Close ${BROWSER_LABELS[b] ?? b} & Connect`}
            </button>
          ))}
        <button
          onClick={() => {
            sessionStorage.setItem(YOUTUBE_CARD_DISMISS_KEY, "1");
            setDismissed(true);
          }}
          aria-label="Dismiss"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

type LineKind = "song" | "spotify" | "youtube" | "unrecognized";

/** One box, three formats — a line is a Spotify/YouTube playlist link if it looks like one,
 * a link we don't recognize (some other site, or a plain YouTube video rather than a
 * playlist — search only ever does a text search, see main.py, so a bare video URL would
 * silently search for its own URL as text and find nothing) if it's a link at all, and a
 * plain "Artist – Title" song query otherwise. */
function classifyLine(line: string): LineKind {
  if (/(^|\.)spotify\.com\/playlist\/|^spotify:playlist:/i.test(line)) return "spotify";
  if (/(youtube\.com|youtu\.be)\/.*[?&]list=/i.test(line)) return "youtube";
  if (/^https?:\/\//i.test(line)) return "unrecognized";
  return "song";
}

function FormatChip({
  icon,
  label,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

const PAGE_SIZE = 10;

function DownloadPage() {
  const [tab, setTab] = useState<"download" | "history">("download");
  const [text, setText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const {
    jobId,
    status,
    items,
    error,
    playlistImportResults,
    start,
    pause,
    resume,
    stop,
    retry,
    clear,
    playableSongs,
    _resumeIfNeeded,
  } = useDownload();
  const playQueue = usePlayer((s) => s.playQueue);
  const currentSong = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);

  // Resume polling if we navigate back to this page and the job is still running
  useEffect(() => {
    _resumeIfNeeded();
  }, [_resumeIfNeeded]);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const songQueries = lines.filter((l) => classifyLine(l) === "song");
  const spotifyUrls = lines.filter((l) => classifyLine(l) === "spotify");
  const youtubeUrls = lines.filter((l) => classifyLine(l) === "youtube");
  const unrecognized = lines.filter((l) => classifyLine(l) === "unrecognized");

  const handleStart = async () => {
    if (!lines.length) return;
    setResolving(true);
    setResolveError(null);
    try {
      const [spotifyRes, youtubeRes] = await Promise.all([
        spotifyUrls.length
          ? resolveSpotifyPlaylists(spotifyUrls)
          : Promise.resolve({ playlists: [] }),
        youtubeUrls.length
          ? resolveYoutubePlaylists(youtubeUrls)
          : Promise.resolve({ playlists: [] }),
      ]);
      const isResolved = (
        p: SpotifyResolvedPlaylist | YoutubeResolvedPlaylist,
      ): p is (SpotifyResolvedPlaylist | YoutubeResolvedPlaylist) & {
        name: string;
        queries: string[];
      } => !!p.queries?.length;
      const spotifyOk = spotifyRes.playlists.filter(isResolved);
      const youtubeOk = youtubeRes.playlists.filter(isResolved);
      const failed = [...spotifyRes.playlists, ...youtubeRes.playlists].filter((p) => p.error);

      const allQueries = [
        ...songQueries,
        ...spotifyOk.flatMap((p) => p.queries),
        ...youtubeOk.flatMap((p) => p.queries),
      ];
      if (!allQueries.length) {
        setResolveError(
          failed.map((f) => `${f.url} — ${f.error}`).join("\n") ||
            "Couldn't read any of those playlists.",
        );
        return;
      }

      setPage(0);
      await start(allQueries, {
        playlists: [
          ...spotifyOk.map((p) => ({
            name: p.name,
            queries: p.queries,
            ...(p.truncated
              ? { note: "Only the first 100 tracks could be read from Spotify" }
              : {}),
          })),
          ...youtubeOk.map((p) => ({
            name: p.name,
            queries: p.queries,
            ...(p.truncated
              ? { note: "Only the first 300 videos could be read from this playlist" }
              : {}),
          })),
        ],
        resolveFailures: failed.map((f) => ({ name: f.url, error: f.error! })),
      });
      setText("");
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  const handlePlay = (itemIndex: number) => {
    const songs = playableSongs();
    const songIdx = songs.findIndex((s) => s.id === `dl-${jobId}-${itemIndex}`);
    if (songs.length && songIdx >= 0) {
      playQueue(songs, songIdx, { label: "Downloads", kind: "download" });
    }
  };

  const isRunning = jobId && status && !status.finished;
  const isFinished = jobId && status?.finished;
  const showInput = !jobId || isFinished;

  const pct =
    status && status.total
      ? Math.round(((status.done + status.skipped + status.errors) / status.total) * 100)
      : 0;

  const allItems = items;
  const totalPages = Math.ceil(allItems.length / PAGE_SIZE);
  const pageItems = allItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-8 pt-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "download" | "history")}>
          <TabsList>
            <TabsTrigger value="download">Download</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "history" && <HistoryPanel />}

      {tab === "download" && (
        <AnimatePresence mode="wait">
          {/* ─── Input Phase ─── */}
          {showInput && !isFinished && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="flex flex-1 flex-col items-center justify-center px-8 py-12"
            >
              <h1 className="text-2xl font-bold">Download</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                One box, mix and match — song names, Spotify playlist links, and YouTube playlist
                links can all go in together.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Music2 className="h-3.5 w-3.5" /> Artist – Title
                </span>
                <span className="flex items-center gap-1.5">
                  <ListMusic className="h-3.5 w-3.5 text-[#1DB954]" /> Spotify playlist link
                </span>
                <span className="flex items-center gap-1.5">
                  <ListMusic className="h-3.5 w-3.5 text-[#FF0000]" /> YouTube playlist link
                </span>
              </div>

              <div className="surface mt-4 w-full max-w-2xl p-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={12}
                  placeholder={
                    "Daft Punk – Digital Love\nhttps://open.spotify.com/playlist/...\nhttps://www.youtube.com/playlist?list=..."
                  }
                  className="w-full resize-y rounded-lg border border-border bg-background p-4 font-mono text-sm outline-none transition-colors focus:border-primary"
                />

                {/* Live breakdown — confirms what each line will actually do before starting. */}
                {lines.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {songQueries.length > 0 && (
                      <FormatChip
                        icon={<Music2 className="h-3.5 w-3.5" />}
                        label={`${songQueries.length} song${songQueries.length === 1 ? "" : "s"}`}
                      />
                    )}
                    {spotifyUrls.length > 0 && (
                      <FormatChip
                        icon={<ListMusic className="h-3.5 w-3.5" />}
                        label={`${spotifyUrls.length} Spotify playlist${spotifyUrls.length === 1 ? "" : "s"}`}
                        className="bg-[#1DB954]/15 text-[#1DB954]"
                      />
                    )}
                    {youtubeUrls.length > 0 && (
                      <FormatChip
                        icon={<ListMusic className="h-3.5 w-3.5" />}
                        label={`${youtubeUrls.length} YouTube playlist${youtubeUrls.length === 1 ? "" : "s"}`}
                        className="bg-[#FF0000]/15 text-[#FF0000]"
                      />
                    )}
                    {unrecognized.length > 0 && (
                      <FormatChip
                        icon={<AlertTriangle className="h-3.5 w-3.5" />}
                        label={`${unrecognized.length} link${unrecognized.length === 1 ? "" : "s"} not recognized — will be skipped`}
                        className="bg-destructive/15 text-destructive"
                      />
                    )}
                  </div>
                )}

                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => void handleStart()}
                    disabled={
                      (!songQueries.length && !spotifyUrls.length && !youtubeUrls.length) ||
                      resolving
                    }
                    className="flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {resolving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {resolving
                      ? spotifyUrls.length || youtubeUrls.length
                        ? "Reading playlists…"
                        : "Starting…"
                      : `Start Download${
                          songQueries.length + spotifyUrls.length + youtubeUrls.length
                            ? ` (${songQueries.length + spotifyUrls.length + youtubeUrls.length})`
                            : ""
                        }`}
                  </button>
                </div>
                {resolveError && (
                  <p className="mt-3 whitespace-pre-line text-center text-xs text-destructive">
                    {resolveError}
                  </p>
                )}
                {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
              </div>
            </motion.div>
          )}

          {/* ─── Active / Finished Phase ─── */}
          {(isRunning || isFinished) && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 px-8 py-8"
            >
              {status?.likelyBlocked && (
                <div className="mb-4">
                  <YoutubeLoginCard />
                </div>
              )}

              {/* Stats bar */}
              <motion.div layout className="surface flex items-center gap-6 px-6 py-4">
                <div className="flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold">{pct}%</span>
                    {status?.paused && (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                        Paused
                      </span>
                    )}
                    {isFinished && status.errors === 0 && (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        Complete
                      </span>
                    )}
                    {isFinished && status.errors > 0 && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                        {status.errors} failed
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      animate={{ width: `${pct}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  {[
                    ["Total", status?.total ?? 0],
                    ["Done", status?.done ?? 0],
                    ["Skipped", status?.skipped ?? 0],
                    ["Errors", status?.errors ?? 0],
                  ].map(([label, val]) => (
                    <div key={String(label)}>
                      <p className="text-lg font-bold tabular-nums">{val}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {isRunning && (
                  <>
                    <button
                      onClick={() => (status!.paused ? resume() : pause())}
                      className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
                    >
                      {status!.paused ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                      {status!.paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      onClick={stop}
                      className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-destructive hover:text-destructive"
                    >
                      <Square className="h-4 w-4" /> Stop
                    </button>
                  </>
                )}
                {isFinished && (
                  <>
                    {status!.errors > 0 && (
                      <button
                        onClick={retry}
                        className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
                      >
                        <RotateCcw className="h-4 w-4" /> Retry failed
                      </button>
                    )}
                    <button
                      onClick={clear}
                      className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-foreground hover:text-foreground"
                    >
                      <Trash2 className="h-4 w-4" /> New download
                    </button>
                  </>
                )}
              </div>

              {/* Playlist import results (Spotify or YouTube) */}
              {playlistImportResults && playlistImportResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  {playlistImportResults.map((r, i) => (
                    <div
                      key={`${r.name}-${i}`}
                      className="surface flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      {r.ok ? (
                        <Check className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <X className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{r.name}</p>
                        {r.note && <p className="truncate text-xs text-warning">{r.note}</p>}
                      </div>
                      <span
                        className={cn(
                          "text-xs",
                          r.ok ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        {r.ok ? `${r.count} song${r.count === 1 ? "" : "s"}` : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Song list */}
              {pageItems.length > 0 && (
                <div className="mt-6">
                  {totalPages > 1 && (
                    <div className="mb-3 flex items-center gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {page + 1} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {pageItems.map((item) => {
                        const isPlayable = item.status === "done" || item.status === "skipped";
                        const isCurrentlyPlaying =
                          isPlayable &&
                          currentSong?.id === `dl-${jobId}-${item.index}` &&
                          isPlaying;

                        return (
                          <motion.div
                            key={`${item.index}-${item.status}`}
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 12 }}
                            transition={{ duration: 0.25 }}
                            className="surface flex items-center gap-4 px-4 py-3"
                          >
                            {isPlayable && jobId ? (
                              <button
                                onClick={() => handlePlay(item.index)}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-primary/15"
                                aria-label={`Play ${item.title}`}
                              >
                                {isCurrentlyPlaying ? (
                                  <Volume2 className="h-4 w-4 text-primary" />
                                ) : (
                                  <Play className="h-4 w-4 text-primary" />
                                )}
                              </button>
                            ) : (
                              <StatusIcon status={item.status} />
                            )}
                            {isPlayable && jobId ? (
                              <img
                                src={withArtworkSize(
                                  jobArtworkUrl(jobId, item.index),
                                  ARTWORK_SIZES.thumb,
                                )}
                                alt=""
                                className="h-10 w-10 shrink-0 rounded-lg bg-muted object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  "truncate text-sm font-medium",
                                  isCurrentlyPlaying && "text-primary",
                                )}
                              >
                                {item.title ?? item.query}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {item.artist ?? item.query}
                                {item.error ? ` · ${item.error}` : ""}
                              </p>
                              {item.status === "downloading" && (
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{
                                      width: `${Math.round((item.progress ?? 0) * 100)}%`,
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                STATUS_STYLES[item.status]?.className,
                              )}
                            >
                              {STATUS_STYLES[item.status]?.label ?? item.status}
                            </span>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

const HISTORY_FILTERS = ["all", "done", "skipped", "error"] as const;

function HistoryPanel() {
  const [jobs, setJobs] = useState<HistoryJobSummary[]>([]);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof HISTORY_FILTERS)[number]>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory()
      .then((r) => setJobs(r.jobs))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!openId) return;
    getHistoryDetail(openId, { page, per_page: 25, status: filter })
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [openId, page, filter]);

  if (openId && detail) {
    return (
      <div className="px-8 py-6">
        <button
          onClick={() => {
            setOpenId(null);
            setDetail(null);
            setPage(1);
          }}
          className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All jobs
        </button>
        <h1 className="text-2xl font-bold">{formatDate(detail.date)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{detail.total} tracks</p>

        <div className="mt-5 flex gap-2">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground",
                filter === f && "bg-primary/15 text-primary",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          {detail.items.map((item) => (
            <div
              key={`${item.index}-${item.query}`}
              className="surface flex items-center gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title ?? item.query}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.artist ?? item.query}
                  {item.error ? ` · ${item.error}` : ""}
                </p>
              </div>
              <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
              {item.status === "error" && (
                <button
                  onClick={() => retryHistoryItem(detail.id, item.query)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Retry
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-full border border-border p-2 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-muted-foreground">
            Page {detail.page} of {detail.pages}
          </span>
          <button
            disabled={page >= detail.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-border p-2 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
      <div className="space-y-2">
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => setOpenId(j.id)}
            className="surface flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:border-primary"
          >
            <Clock className="h-4 w-4 text-primary" />
            <span className="flex-1 text-sm font-medium">{formatDate(j.date)}</span>
            <span className="text-xs text-muted-foreground">{j.total} tracks</span>
            <span className="text-xs text-success">{j.done} done</span>
            {j.errors > 0 && <span className="text-xs text-destructive">{j.errors} errors</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
