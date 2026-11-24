// The Mac-style window titlebar (the OS frame is off, decorations: false):
// traffic lights (real minimize / maximize / close), the stack wordmark, and
// two slots the app fills once onboarding is done: the Project | Browse
// switcher (center) and the search / project / theme cluster (right).
// Always rendered, even during onboarding: a frameless window needs its
// close button. Under the mock bridge the window calls resolve to no-ops.
import type { JSX } from 'solid-js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BrandMark } from '../icons';

function current() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export default function TitleBar(props: { center?: JSX.Element; right?: JSX.Element }) {
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
    <header id="titlebar" class="sa-shell__titlebar" data-tauri-drag-region>
      <div class="sa-shell__titlebar-left" data-tauri-drag-region>
        <div class="sa-shell__traffic" role="group" aria-label="window controls">
          <button
            type="button"
            class="sa-shell__traffic-btn sa-shell__traffic-btn--close"
            tabindex="-1"
            title="close"
            aria-label="close"
            onClick={act((w) => w.close())}
          />
          <button
            type="button"
            class="sa-shell__traffic-btn sa-shell__traffic-btn--minimize"
            tabindex="-1"
            title="minimize"
            aria-label="minimize"
            onClick={act((w) => w.minimize())}
          />
          <button
            type="button"
            class="sa-shell__traffic-btn sa-shell__traffic-btn--maximize"
            tabindex="-1"
            title="maximize"
            aria-label="maximize"
            onClick={act((w) => w.toggleMaximize())}
          />
        </div>
        <div class="sa-shell__brand" data-tauri-drag-region>
          <BrandMark />
          <span class="sa-shell__brand-title">stack</span>
        </div>
      </div>
      <div class="sa-shell__titlebar-center" data-tauri-drag-region>{props.center}</div>
      <div class="sa-shell__titlebar-right" data-tauri-drag-region>{props.right}</div>
    </header>
  );
}
