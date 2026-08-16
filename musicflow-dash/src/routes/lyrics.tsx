import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MicVocal,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react";
import type { LyricsGenStatus } from "@/lib/api";
import { useLibrary } from "@/store/library";
import { useLyricsGen } from "@/store/lyricsGen";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lyrics")({
  component: LyricsPage,
});

const STATUS_STYLES: Record<LyricsGenStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  processing: { label: "Fetching", className: "text-primary" },
  done: { label: "Found", className: "text-success" },
  not_found: { label: "Not found", className: "text-warning" },
  cancelled: { label: "Stopped", className: "text-muted-foreground" },
};

function StatusIcon({ status }: { status: LyricsGenStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "not_found") return <SkipForward className="h-4 w-4 text-warning" />;
  if (status === "processing") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "cancelled") return <XCircle className="h-4 w-4 text-muted-foreground" />;
  return <span className="h-2 w-2 rounded-full bg-muted-foreground" />;
}

const PAGE_SIZE = 10;

function LyricsPage() {
  const folder = useLibrary((s) => s.settings.musicFolder);
  const { jobId, status, error, starting, stopping, start, stop, reset, _resumeIfNeeded } =
    useLyricsGen();
  const [page, setPage] = useState(0);

  // Resume polling if we navigate back to this page and the job is still running
  useEffect(() => {
    _resumeIfNeeded();
  }, [_resumeIfNeeded]);

  const handleStart = async () => {
    setPage(0);
    await start(folder);
  };

  const pct = status && status.total ? Math.round((status.processed / status.total) * 100) : 0;
  const totalPages = status ? Math.ceil(status.items.length / PAGE_SIZE) : 0;
  const pageItems = status ? status.items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h1 className="text-2xl font-bold">Lyrics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Scan your music folder and fetch lyrics for every track.
      </p>

      {!folder && (
        <p className="mt-6 text-xs text-destructive">
          Set a music folder in Settings before generating lyrics.
        </p>
      )}

      {!jobId && folder && (
        <button
          onClick={handleStart}
          disabled={starting}
          className="mt-6 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
        >
          <MicVocal className="h-4 w-4" /> {starting ? "Starting…" : "Generate lyrics for library"}
        </button>
      )}

      {error && <p className="mt-4 text-xs text-destructive">{error}</p>}

      {jobId && status && (
        <div className="mt-6">
          <div className="surface flex items-center gap-6 px-6 py-4">
            <div className="flex-1">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold">{pct}%</span>
                {status.finished && status.cancelled && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    Stopped
                  </span>
                )}
                {status.finished && !status.cancelled && status.not_found === 0 && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                    Complete
                  </span>
                )}
                {status.finished && !status.cancelled && status.not_found > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                    {status.not_found} not found
                  </span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="flex gap-4 text-center">
              {[
                ["Total", status.total],
                ["Done", status.done],
                ["Not found", status.not_found],
              ].map(([label, val]) => (
                <div key={String(label)}>
                  <p className="text-lg font-bold tabular-nums">{val}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {!status.finished && (
            <div className="mt-4">
              <button
                onClick={() => void stop()}
                disabled={stopping || status.cancelled}
                className="flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                {status.cancelled ? "Stopping…" : stopping ? "Stopping…" : "Stop"}
              </button>
            </div>
          )}

          {status.finished && (
            <div className="mt-4">
              <button
                onClick={() => {
                  reset();
                  setPage(0);
                }}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
              >
                Run again
              </button>
            </div>
          )}

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
                {pageItems.map((item) => (
                  <div key={item.file} className="surface flex items-center gap-4 px-4 py-3">
                    <StatusIcon status={item.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.file}</p>
                      {item.status === "done" && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.found_count} source{item.found_count === 1 ? "" : "s"} found
                        </p>
                      )}
                      {item.error && (
                        <p className="truncate text-xs text-muted-foreground">{item.error}</p>
                      )}
                    </div>
                    <span
                      className={cn("text-xs font-medium", STATUS_STYLES[item.status]?.className)}
                    >
                      {STATUS_STYLES[item.status]?.label ?? item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
