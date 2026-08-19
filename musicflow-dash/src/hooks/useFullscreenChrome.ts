import { useEffect, useState } from "react";

/**
 * Tracks real (OS-level) fullscreen state, and — when `trackMouseIdle` is on — whether the
 * mouse has gone idle (no movement for 5s). Callers combine `docFullscreen`/`mouseIdle`
 * themselves into whatever visibility rule fits: the title bar only ever cares about
 * `docFullscreen` (never shows in real fullscreen, otherwise always on — it's independent of
 * whether the full-screen player is even open); the full-screen player's own header idle-
 * reveals in its normal windowed view but never at all in real fullscreen; its lyrics controls
 * and style switcher idle-reveal in both. One shared hook, one mouse listener, three different
 * combinations of the same two booleans.
 */
export function useFullscreenChrome(trackMouseIdle = false) {
  const [docFullscreen, setDocFullscreen] = useState(() => !!document.fullscreenElement);
  const [mouseIdle, setMouseIdle] = useState(false);

  useEffect(() => {
    const onChange = () => setDocFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!trackMouseIdle) {
      setMouseIdle(false);
      return;
    }
    // Starts "active" (grace period) so chrome is visible the instant this turns on, rather
    // than requiring a mouse move first.
    setMouseIdle(false);
    let timeout: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setMouseIdle(true), 5000);
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
  }, [trackMouseIdle]);

  return { docFullscreen, mouseIdle };
}
