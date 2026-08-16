import { useEffect, useMemo, useState } from "react";
import { Check, ListMusic, Loader2, Search, X } from "lucide-react";
import type { Song } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLibrary, type CreatePlaylistResult } from "@/store/library";
import { parseTextPlaylists, resolveTextPlaylists } from "@/lib/textPlaylist";
import { cn } from "@/lib/utils";

const TEXT_PLACEHOLDER = `Bohemian Rhapsody
Don't Stop Believin'
Weightless

--playlistadd Late Night Drive
Nightcall
Sunset Rubdown
--playlistend`;

export function CreatePlaylistDialog({
  open,
  onOpenChange,
  songs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songs: Song[];
}) {
  const [mode, setMode] = useState<"build" | "text">("build");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textResults, setTextResults] = useState<CreatePlaylistResult[] | null>(null);

  const createPlaylistWithSongs = useLibrary((s) => s.createPlaylistWithSongs);
  const createPlaylistsFromBlocks = useLibrary((s) => s.createPlaylistsFromBlocks);

  // Reset all local state whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setMode("build");
    setName("");
    setQuery("");
    setSelected([]);
    setText("");
    setSubmitting(false);
    setError(null);
    setTextResults(null);
  }, [open]);

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? songs.filter(
          (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
        )
      : songs;
    return list.slice(0, 200);
  }, [songs, query]);

  const resolvedBlocks = useMemo(() => {
    if (mode !== "text" || !text.trim()) return [];
    const parsed = parseTextPlaylists(text, name);
    return resolveTextPlaylists(parsed, songs);
  }, [mode, text, name, songs]);

  const toggleSong = (path: string) =>
    setSelected((s) => (s.includes(path) ? s.filter((p) => p !== path) : [...s, path]));

  const canCreateBuild = name.trim().length > 0 && !submitting;
  const canCreateText =
    resolvedBlocks.some((b) => b.songPaths.length > 0 || b.name.trim()) && !submitting;

  const handleCreateBuild = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    const result = await createPlaylistWithSongs(trimmed, selected);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't create the playlist");
      return;
    }
    onOpenChange(false);
  };

  const handleCreateText = async () => {
    if (!resolvedBlocks.length) return;
    setSubmitting(true);
    setError(null);
    const results = await createPlaylistsFromBlocks(
      resolvedBlocks
        .filter((b) => b.name.trim())
        .map((b) => ({ name: b.name.trim(), songPaths: b.songPaths })),
    );
    setSubmitting(false);
    setTextResults(results);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Playlist</DialogTitle>
          <DialogDescription>
            Pick songs by hand, or paste a list of titles and let Musicflow match them.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "build" | "text")}>
          <TabsList>
            <TabsTrigger value="build">Pick songs</TabsTrigger>
            <TabsTrigger value="text">Paste text</TabsTrigger>
          </TabsList>

          <TabsContent value="build" className="mt-4 space-y-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name"
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            />

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs to add…"
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {filteredSongs.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No songs match.</p>
              )}
              {filteredSongs.map((s) => {
                const checked = selected.includes(s.path);
                return (
                  <label
                    key={s.path}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-accent",
                      checked && "bg-primary/5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSong(s.path)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.artist}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {selected.length} song{selected.length === 1 ? "" : "s"} selected
              </span>
              {selected.length > 0 && (
                <button
                  onClick={() => setSelected([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => onOpenChange(false)}
                className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateBuild()}
                disabled={!canCreateBuild}
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Playlist
              </button>
            </div>
          </TabsContent>

          <TabsContent value="text" className="mt-4 space-y-4">
            {!textResults ? (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Playlist name (used unless the text below sets its own)"
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                />
                <div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={8}
                    placeholder={TEXT_PLACEHOLDER}
                    className="w-full resize-y rounded-xl border border-border bg-background p-4 font-mono text-sm outline-none transition-colors focus:border-primary"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    One song per line. Wrap a block in{" "}
                    <code className="rounded bg-muted px-1 py-0.5">--playlistadd Name</code> /{" "}
                    <code className="rounded bg-muted px-1 py-0.5">--playlistend</code> to create
                    more than one playlist at once — anything outside a block goes into the
                    playlist named above.
                  </p>
                </div>

                {resolvedBlocks.length > 0 && (
                  <div className="max-h-56 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                    {resolvedBlocks.map((b, i) => {
                      const matched = b.matches.filter((m) => m.song).length;
                      const unmatched = b.matches.filter((m) => !m.song);
                      return (
                        <div key={`${b.name}-${i}`}>
                          <p className="text-sm font-semibold">
                            {b.name || <span className="italic text-muted-foreground">Unnamed</span>}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {matched} matched
                              {unmatched.length > 0 ? ` · ${unmatched.length} not found` : ""}
                            </span>
                          </p>
                          {unmatched.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {unmatched.map((m, j) => (
                                <li
                                  key={j}
                                  className="flex items-center gap-1.5 text-xs text-destructive"
                                >
                                  <X className="h-3 w-3 shrink-0" /> {m.line}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {error && <p className="text-xs text-destructive">{error}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    onClick={() => onOpenChange(false)}
                    className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleCreateText()}
                    disabled={!canCreateText}
                    className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create {resolvedBlocks.length > 1 ? `${resolvedBlocks.length} Playlists` : "Playlist"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  {textResults.map((r) => (
                    <div
                      key={r.name}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      {r.ok ? (
                        <Check className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <X className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{r.name}</span>
                      {!r.ok && <span className="text-xs text-destructive">{r.error}</span>}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => onOpenChange(false)}
                    className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
