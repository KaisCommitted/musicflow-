import { useEffect, type ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { PlayerBar } from "@/components/PlayerBar";
import { QueuePanel } from "@/components/QueuePanel";
import { FullScreenPlayer } from "@/components/FullScreenPlayer";
import { SongContextMenu } from "@/components/SongContextMenu";
import { FolderSetupGate } from "@/components/FolderSetupGate";
import { TitleBar } from "@/components/TitleBar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useLibrary } from "@/store/library";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useDiscordPresence } from "@/hooks/useDiscordPresence";
import { applyUiScale } from "@/lib/uiScale";
import { initScrobbling } from "@/lib/scrobbling";

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useLibrary((s) => s.settings.theme);
  const uiScale = useLibrary((s) => s.settings.uiScale);
  const musicFolder = useLibrary((s) => s.settings.musicFolder);
  const error = useLibrary((s) => s.error);
  const loadSettings = useLibrary((s) => s.loadSettings);
  const settingsLoaded = useLibrary((s) => s.settingsLoaded);
  const refresh = useLibrary((s) => s.refresh);
  useKeyboardShortcuts();
  useDiscordPresence();

  useEffect(() => {
    initScrobbling();
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Validate the configured folder once settings are known — catches both
  // "never configured" and "configured but no longer found" cases.
  useEffect(() => {
    if (settingsLoaded) void refresh();
  }, [settingsLoaded, refresh]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  useEffect(() => {
    applyUiScale(uiScale);
  }, [uiScale]);

  if (!settingsLoaded) {
    return (
      <div className="flex h-screen w-full flex-col bg-background">
        <TitleBar />
      </div>
    );
  }

  if (!musicFolder || error) {
    return (
      <div className="flex h-screen w-full flex-col bg-background">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <FolderSetupGate />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          <PlayerBar />
        </div>
        <QueuePanel />
        <FullScreenPlayer />
        <SongContextMenu />
        <UpdateBanner />
      </div>
    </div>
  );
}
