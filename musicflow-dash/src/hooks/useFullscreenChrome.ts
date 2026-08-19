import { useEffect, useState } from "react";

/**
 * Tracks real (OS-level) fullscreen state and whether window/player chrome — the Electron
 * title bar, the full-screen player's own header — should currently be shown.
 *
 * Outside real fullscreen, chrome always shows (it's just the windowed app). Inside it, an
 * immersive view showing its own permanent chrome on top defeats the point, but hiding it
 * outright strands the only way back out — so it's idle-hidden instead: visible while the
 * mouse is moving, fading out 1s after it stops, back the instant it moves again. Shared by
 * TitleBar and FullScreenPlayer so both hide/reveal in lockstep off one source of truth.
 */
export function useFullscreenChrome() {
  const [docFullscreen, setDocFullscreen] = useState(() => !!document.fullscreenElement);
  const [mouseIdle, setMouseIdle] = useState(false);

  useEffect(() => {
    const onChange = () => setDocFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!docFullscreen) {
      setMouseIdle(false);
      return;
    }
    setMouseIdle(false);
    let timeout: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setMouseIdle(true), 1000);
    };
    const onMove = () => {
      setMouseIdle(false);
      arm();
    };
    arm();
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(timeout);
    };
  }, [docFullscreen]);

  return { docFullscreen, showChrome: !docFullscreen || !mouseIdle };
}
