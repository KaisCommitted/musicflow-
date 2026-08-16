import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Disc3,
  ListEnd,
  ListPlus,
  Play,
  Plus,
  Trash2,
  User,
} from "lucide-react";
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
  const { playlists, addPlaylist, addSongToPlaylist, removeSongFromPlaylist } = useLibrary();
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

  if (!song) return null;

  const go = (fn: () => void) => {
    fn();
    void navigate({ to: "/" });
    close();
  };

  return (
    <div
      style={{ top: Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - 380), left: x }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] w-60 rounded-xl border border-border bg-popover p-1.5 shadow-elevated"
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

      <div className="relative" onMouseEnter={() => setSubmenu(true)} onMouseLeave={() => setSubmenu(false)}>
        <Item
          icon={<Plus className="h-4 w-4" />}
          label="Add to Playlist ▸"
          onClick={() => setSubmenu((v) => !v)}
        />
        {submenu && (
          <div className="absolute left-full top-0 ml-1 max-h-64 w-52 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-elevated">
            {playlists.map((p) => (
              <Item
                key={p.name}
                icon={<ListPlus className="h-4 w-4" />}
                label={p.name}
                onClick={() => {
                  addSongToPlaylist(p.name, song.path);
                  close();
                }}
              />
            ))}
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
          </div>
        )}
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
    </div>
  );
}
