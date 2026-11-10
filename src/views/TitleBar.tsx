// Custom window chrome: the OS frame is off (decorations: false), so this
// bar owns dragging (Tauri's drag region) plus mono minimize / maximize / close. Always rendered
// (even during onboarding — a frameless window needs its close button).
// Under the mock bridge the window calls resolve to no-ops.
import { getCurrentWindow } from '@tauri-apps/api/window';

function current() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export default function TitleBar() {
  const act =
    (fn: (w: NonNullable<ReturnType<typeof current>>) => Promise<void>) => () => {
      const w = current();
      if (w) void fn(w).catch(() => {});
    };

  // Dragging and double-click-to-maximize are Tauri's own: its injected script
  // handles `data-tauri-drag-region` (start_dragging, internal_toggle_maximize),
  // which needs `core:window:allow-start-dragging` in capabilities/default.json.
  // No dblclick handler here: it would toggle a second time and undo it.
  return (
    <header id="titlebar" data-tauri-drag-region>
      <span class="tbrand" data-tauri-drag-region>
        stack
      </span>
      <span class="tbtns">
        <button class="wbtn" title="minimize" aria-label="minimize" onClick={act((w) => w.minimize())}>
          _
        </button>
        <button
          class="wbtn"
          title="maximize"
          aria-label="maximize"
          onClick={act((w) => w.toggleMaximize())}
        >
          □
        </button>
        <button class="wbtn close" title="close" aria-label="close" onClick={act((w) => w.close())}>
          ×
        </button>
      </span>
    </header>
  );
}
