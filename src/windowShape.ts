// Rounded window corners: the frameless window is transparent and the shell clips itself to a rounded
// rectangle (app.css, #shell). A maximized or fullscreen window has no corners to show, so it goes square.
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Keep `html[data-square]` in step with the window state; returns a cleanup. */
export function trackWindowShape(): () => void {
  let w: ReturnType<typeof getCurrentWindow>;
  try {
    w = getCurrentWindow();
  } catch {
    return () => {};
  }
  let off: (() => void) | undefined;
  let gone = false;
  let seq = 0;
  const sync = async () => {
    const mine = ++seq;
    try {
      const square = (await w.isMaximized()) || (await w.isFullscreen());
      // A newer resize overtook this one while its answers were in flight.
      if (mine !== seq) return;
      document.documentElement.toggleAttribute('data-square', square);
    } catch {
      /* not running under Tauri (mock bridge) */
    }
  };
  void sync();
  void w
    .onResized(() => void sync())
    .then((un) => (gone ? un() : (off = un)))
    .catch(() => {});
  return () => {
    gone = true;
    off?.();
  };
}
