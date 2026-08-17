import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

  const hasIssues =
    issues && (issues.duplicate_groups.length > 0 || issues.standalone_corrupt.length > 0);
  const plan = hasIssues ? removalPlan(issues) : null;

  const confirmDelete = async () => {
    if (!plan || plan.paths.length === 0) return;
    setDeleting(true);
    try {
      await deleteIssueFiles(plan.paths);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AnimatePresence>
      {plan && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden"
        >
          <div className="surface flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {plan.mp3Count} duplicate/corrupt file{plan.mp3Count === 1 ? "" : "s"} found
                  {plan.bytes > 0 && ` (${formatBytes(plan.bytes)})`}
                </p>
                <p className="text-xs text-muted-foreground">
                  The best-named, best-quality copy of each song is kept automatically.
                  {plan.lostSongs > 0 &&
                    ` ${plan.lostSongs} song${plan.lostSongs === 1 ? "" : "s"} have no working copy at all and were left untouched.`}
                </p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={plan.paths.length === 0 || deleting}
              onClick={() => void confirmDelete()}
              className="flex shrink-0 items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete duplicates
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
