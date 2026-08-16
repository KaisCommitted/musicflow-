import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { browseFolder } from "@/lib/api";

export function FolderPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={className ?? "flex w-full max-w-md items-center gap-2"}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/path/to/folder"
        className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary"
      />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { folder } = await browseFolder();
            if (folder) onChange(folder);
          } catch {
            /* native picker unavailable — keep manual input */
          } finally {
            setBusy(false);
          }
        }}
        className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-xs transition-colors hover:border-primary hover:text-primary"
      >
        <FolderOpen className="h-4 w-4" /> Browse
      </button>
    </div>
  );
}
