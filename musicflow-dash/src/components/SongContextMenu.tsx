import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Disc3, ListEnd, ListPlus, Play, Plus, Trash2, User } from "lucide-react";
import { useSongMenu } from "@/store/menu";
import { usePlayer } from "@/store/player";
import { useLibrary } from "@/store/library";
import { useView } from "@/store/view";
import { cn } from "@/lib/utils";

function Item({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent",
        danger && "text-destructive",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function SongContextMenu() {
  const { song, contextSongs, contextLabel, playlistName, x, y, close } = useSongMenu();
  const { playQueue, playNext, addToQueue } = usePlayer();
  const { playlists, addPlaylist, addSongToPlaylist, removeSongFromPlaylist, deleteSong } =
    useLibrary();
  const { openAlbum, openArtist } = useView();
  const navigate = useNavigate();
  const [submenu, setSubmenu] = useState(false);

  useEffect(() => {
    if (!song) setSubmenu(false);
    const onDown = () => close();
    window.addEventListener("click", onDown);
    window.addEventListener("contextmenu", onDown);
    return () => {
      window.removeEventListener("click", onDown);
      window.removeEventListener("contextmenu", onDown);
    };
  }, [song, close]);

  const go = (fn: () => void) => {
    fn();
    void navigate({ to: "/" });
    close();
  };

  return (
    <AnimatePresence>
      {song && (
        <motion.div
          key="song-context-menu"
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{
            top: Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - 380),
            left: x,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-[60] w-60 origin-top-left rounded-xl border border-border bg-popover p-1.5 shadow-elevated"
        >
          <p className="truncate px-2.5 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            {song.title}
          </p>
          <Item
            icon={<Play className="h-4 w-4" />}
            label="Play Now"
            onClick={() => {
              const i = contextSongs.findIndex((s) => s.id === song.id);
              playQueue(contextSongs, Math.max(0, i), { label: contextLabel, kind: "all" });
              close();
            }}
          />
          <Item
            icon={<ListPlus className="h-4 w-4" />}
            label="Play Next"
            onClick={() => {
              playNext(song);
              close();
            }}
          />
          <Item
            icon={<ListEnd className="h-4 w-4" />}
            label="Add to Queue"
            onClick={() => {
              addToQueue([song]);
              close();
            }}
          />

          <div className="my-1 h-px bg-border" />

          <div
            className="relative"
            onMouseEnter={() => setSubmenu(true)}
            onMouseLeave={() => setSubmenu(false)}
          >
            <Item
              icon={<Plus className="h-4 w-4" />}
              label="Playlists ▸"
              onClick={() => setSubmenu((v) => !v)}
            />
            <AnimatePresence>
              {submenu && (
                <motion.div
                  initial={{ opacity: 0, x: -8, scale: 0.96 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -8, scale: 0.96 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  className="absolute left-full top-0 ml-1 max-h-64 w-56 origin-top-left overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-elevated"
                >
                  {playlists.map((p) => {
                    const inPlaylist = p.songs.includes(song.path);
                    return (
                      <Item
                        key={p.name}
                        icon={
                          inPlaylist ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <ListPlus className="h-4 w-4" />
                          )
                        }
                        label={p.name}
                        onClick={() => {
                          if (inPlaylist) removeSongFromPlaylist(p.name, song.path);
                          else addSongToPlaylist(p.name, song.path);
                          // Keep the submenu open — toggling more than one playlist in a row
                          // shouldn't require reopening it each time.
                        }}
                      />
                    );
                  })}
                  <div className="my-1 h-px bg-border" />
                  <Item
                    icon={<Plus className="h-4 w-4" />}
                    label="Create New…"
                    onClick={() => {
                      const name = window.prompt("New playlist name");
                      if (name) {
                        addPlaylist(name);
                        addSongToPlaylist(name, song.path);
                      }
                      close();
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {playlistName && (
            <Item
              icon={<Trash2 className="h-4 w-4" />}
              label={`Remove from ${playlistName}`}
              danger
              onClick={() => {
                removeSongFromPlaylist(playlistName, song.path);
                close();
              }}
            />
          )}

          <div className="my-1 h-px bg-border" />
          <Item
            icon={<Disc3 className="h-4 w-4" />}
            label="Go to Album"
            onClick={() => go(() => openAlbum(song.album))}
          />
          <Item
            icon={<User className="h-4 w-4" />}
            label="Go to Artist"
            onClick={() => go(() => openArtist(song.artist))}
          />

          <div className="my-1 h-px bg-border" />
          <Item
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete Song…"
            danger
            onClick={() => {
              const ok = window.confirm(
                `Permanently delete "${song.title}"? This removes the file, its metadata, and its lyrics from disk — it can't be undone.`,
              );
              close();
              if (ok) void deleteSong(song.path);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
