import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { type LibraryIssuesReport } from "@/lib/api";
import { useLibrary } from "@/store/library";
import { formatBytes } from "@/lib/format";

/** Every non-keeper file across all resolvable duplicate groups, plus standalone corrupt
 * files and their .lrc sidecars. Groups where every copy is corrupt are left out — deleting
 * all of them would lose the song entirely, so those aren't touched by the bulk action. */
function removalPlan(report: LibraryIssuesReport) {
  const paths: string[] = [];
  let mp3Count = 0;
  let bytes = 0;

  for (const g of report.duplicate_groups) {
    if (g.all_corrupt) continue;
    for (const f of g.files) {
      if (f.keep) continue;
      paths.push(f.path, ...f.related);
      mp3Count++;
      bytes += f.size;
    }
  }
  for (const f of report.standalone_corrupt) {
    paths.push(f.path, ...f.related);
    mp3Count++;
    bytes += f.size;
  }

  const lostSongs = report.duplicate_groups.filter((g) => g.all_corrupt).length;
  return { paths, mp3Count, bytes, lostSongs };
}

/** Duplicate/corrupt-file report laid out under the scan controls — populated automatically
 * by every library scan (initial load and Rescan alike). One bulk action, no per-file review:
 * the app decides which copy of each song to keep (correct filename, then size, then
 * completeness) rather than asking the user to pick. */
export function LibraryIssuesPanel() {
  const issues = useLibrary((s) => s.issues);
  const deleteIssueFiles = useLibrary((s) => s.deleteIssueFiles);
  const [deleting, setDeleting] = useState(false);

  if (!issues) return null;
  const hasIssues = issues.duplicate_groups.length > 0 || issues.standalone_corrupt.length > 0;
  if (!hasIssues) return null;

  const { paths, mp3Count, bytes, lostSongs } = removalPlan(issues);

  const confirmDelete = async () => {
    if (paths.length === 0) return;
    setDeleting(true);
    try {
      await deleteIssueFiles(paths);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="surface flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {mp3Count} duplicate/corrupt file{mp3Count === 1 ? "" : "s"} found
            {bytes > 0 && ` (${formatBytes(bytes)})`}
          </p>
          <p className="text-xs text-muted-foreground">
            The best-named, best-quality copy of each song is kept automatically.
            {lostSongs > 0 &&
              ` ${lostSongs} song${lostSongs === 1 ? "" : "s"} have no working copy at all and were left untouched.`}
          </p>
        </div>
      </div>
      <button
        disabled={paths.length === 0 || deleting}
        onClick={() => void confirmDelete()}
        className="flex shrink-0 items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-50"
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Delete duplicates
      </button>
    </div>
  );
}
