import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Disc3,
  Download,
  Library,
  ListMusic,
  MicVocal,
  Radio,
  Settings,
  Tag,
  User,
} from "lucide-react";
import { useState } from "react";
import { usePlayer, type PlayContext } from "@/store/player";
import { useLibrary } from "@/store/library";
import { useView } from "@/store/view";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Library", icon: Library },
  { to: "/download", label: "Download", icon: Download },
  { to: "/lyrics", label: "Lyrics", icon: MicVocal },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function contextIcon(kind: PlayContext["kind"]) {
  if (kind === "album") return Disc3;
  if (kind === "artist") return User;
  if (kind === "genre") return Tag;
  if (kind === "playlist") return ListMusic;
  return Radio;
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const recentContexts = usePlayer((s) => s.recentContexts);
  const playQueue = usePlayer((s) => s.playQueue);
  const songs = useLibrary((s) => s.songs);
  const playlists = useLibrary((s) => s.playlists);
  const { openAlbum, openArtist, openGenre, openPlaylist, setTab } = useView();

  const resume = (ctx: PlayContext) => {
    let list = songs;
    if (ctx.kind === "album") {
      list = songs.filter((s) => s.album === ctx.label);
      openAlbum(ctx.label);
    } else if (ctx.kind === "artist") {
      list = songs.filter((s) => s.artist === ctx.label);
      openArtist(ctx.label);
    } else if (ctx.kind === "genre") {
      list = songs.filter((s) => (s.genre.trim() || "Unknown") === ctx.label);
      openGenre(ctx.label);
    } else if (ctx.kind === "playlist") {
      const p = playlists.find((x) => x.name === ctx.label);
      list = p ? songs.filter((s) => p.songs.includes(s.path)) : songs;
      openPlaylist(ctx.label);
    } else {
      setTab("songs");
    }
    if (list.length) playQueue(list, 0, ctx);
  };

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300",
        collapsed ? "w-[76px]" : "w-60",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow"
          aria-hidden
        >
          <Radio className="h-5 w-5" />
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="brand-text text-lg font-extrabold"
            >
              Musicflow
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-accent hover:text-foreground",
                active && "text-primary",
                collapsed && "justify-center px-0",
              )}
              title={label}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-pill"
                  className="absolute inset-0 rounded-lg bg-primary/15"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="relative z-10">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-7 min-h-0 flex-1 px-3">
          <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Jump back in
          </p>
          {recentContexts.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground/70">Nothing played yet.</p>
          ) : (
            <ul className="space-y-1">
              <AnimatePresence initial={false}>
                {recentContexts.map((ctx) => {
                  const Icon = contextIcon(ctx.kind);
                  return (
                    <motion.li
                      key={ctx.label}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    >
                      <button
                        onClick={() => resume(ctx)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-sidebar-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{ctx.label}</span>
                        <Clock className="ml-auto h-3 w-3 shrink-0 opacity-40" />
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      )}

      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="m-3 mt-auto flex items-center justify-center gap-2 rounded-lg border border-sidebar-border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={collapsed ? "right" : "left"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="grid place-items-center"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
        {!collapsed && "Collapse"}
      </button>
    </aside>
  );
}
