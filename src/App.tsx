import { Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { setActionRunner } from './humanize';
import { actionError, addStackCommand, backgroundRefresh, revalidateStack, setShowSetup, showSetup, switchProject, boot, bootError, cliNote, config, configNotice, dismissCliNote, projectDone, stack, whoDone, workerSkipped } from './store';
import { href, legacyRedirect, parseHash, resolveView } from './router';
import { readSavedRoute, restoreRoute, saveRoute } from './remember';
import { runShortcut } from './commands';
import { attachSmooth } from './smooth';
import { DialogHost } from './dialog';
import { openPalette, paletteOpen, setPaletteOpen } from './overlays';
import { modalOpen } from './modal';
import { ToastRegion } from './toast';
import { Overlays } from './views/Palette';
import TitleBar from './views/TitleBar';
import { TitleTools, ViewSwitch } from './views/TopBar';
import Sidebar from './views/Sidebar';
import Browse from './views/Browse';
import Project from './views/Project';
import { NotFound } from './views/NotFound';
import StackSetup from './views/StackSetup';
import { Alert, Button, CliErr, IconButton, Rich } from './ui';
import { Icon } from './icons';
import { onboardStep } from './onboard';
import { ProjectScreen, WhoScreen } from './views/Onboard';

export default function App() {
  const [hash, setHash] = createSignal(parseHash(location.hash));
  // Old routes that moved (`#/presets` is Browse's Presets kind) are replaced in the URL.
  const settle = () => {
    const cur = parseHash(location.hash);
    const to = legacyRedirect(cur.segs);
    if (to) location.replace(href(cur.scenario, ...to));
    setHash(parseHash(location.hash));
  };
  const onHash = settle;
  // Cmd/Ctrl+K and the command shortcuts. Inside a modal the keys never get
  // here (the modal stops them); this also guards a modal opened elsewhere.
  const onKey = (ev: KeyboardEvent) => {
    if (!chrome() || blocked() || modalOpen()) return;
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (paletteOpen()) setPaletteOpen(false);
      else openPalette();
      return;
    }
    runShortcut(ev);
  };
  onMount(() => {
    onCleanup(attachSmooth());
    // Land on the last route when the URL names none.
    const back = restoreRoute(parseHash(location.hash).segs, readSavedRoute());
    if (back) {
      location.replace(href(parseHash(location.hash).scenario, ...back));
    }
    settle();
    addEventListener('hashchange', onHash);
    addEventListener('keydown', onKey);
    // Project tab badge: a light background read on focus / when the window
    // becomes visible again, and every five minutes. Skips while an op runs.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void backgroundRefresh();
    };
    const onFocus = () => void backgroundRefresh();
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const every = setInterval(() => void backgroundRefresh(), 5 * 60 * 1000);
    cleanupBg = () => {
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(every);
    };
    setActionRunner((id) => {
      const scenario = parseHash(location.hash).scenario;
      switch (id) {
        case 'open-setup':
          setShowSetup(true);
          break;
        case 'recheck':
          void revalidateStack();
          break;
        case 'run-init':
        case 'restore':
          location.hash = href(scenario, 'project');
          break;
        case 'open-project':
          switchProject();
          break;
        case 'add-command':
          void addStackCommand();
          break;
        case 'get-node':
          window.open('https://nodejs.org/', '_blank', 'noopener,noreferrer');
          break;
        default:
          break;
      }
    });
    void boot();
  });
  let cleanupBg = () => {};
  onCleanup(() => {
    cleanupBg();
    removeEventListener('hashchange', onHash);
    removeEventListener('keydown', onKey);
  });

  // First Tab stop: jump past the titlebar and sidebar to the list (Browse) or the page.
  const skipToContent = () => {
    const list = document.getElementById('entry-list');
    if (list) list.focus();
    else document.getElementById('app')?.focus();
  };
  const segs = () => hash().segs;
  const view = () => resolveView(segs());
  const blocked = () => (stack() != null && !stack()?.valid) || showSetup();
  // First run: one question per screen (who, then which project) instead
  // of the router. The shell chrome hides until both are answered.
  const step = () => {
    const c = config();
    return c ? onboardStep(c.worker, c.project, workerSkipped(), whoDone(), projectDone()) : null;
  };
  // The sidebar and the titlebar tools only exist once first-run questions are answered.
  const chrome = () => !step() && !!config();
  // Remember the route once the shell shows (not while onboarding).
  createEffect(() => {
    if (chrome() && !blocked()) saveRoute(segs());
  });

  return (
    <>
    <button type="button" class="skip-link" onClick={skipToContent}>
      Skip to content
    </button>
    <div id="shell" class="sa-shell" data-nosidebar={chrome() && !blocked() ? undefined : ''}>
      <TitleBar
        center={
          <Show when={chrome() && !blocked()}>
            <ViewSwitch scenario={hash().scenario} segs={segs()} />
          </Show>
        }
        right={
          <Show when={chrome()}>
            <TitleTools scenario={hash().scenario} segs={segs()} />
          </Show>
        }
      />
      <div class="sa-shell__workspace">
        <Show when={chrome() && !blocked()}>
          <Sidebar scenario={hash().scenario} segs={segs()} />
        </Show>
        <div class="sa-shell__sheet-wrap">
      <main id="app" class="sa-shell__sheet" tabindex="-1">
        <Show when={bootError()}>
          <CliErr text={bootError() ?? ''} />
        </Show>
        <Show when={actionError()}>
          <CliErr text={actionError() ?? ''} />
        </Show>
        <Show when={configNotice()}>
          <Alert tone="info" role="status">{configNotice()}</Alert>
        </Show>
        <Show when={cliNote()}>
          {(n) => (
            <Alert
              tone="info"
              role="status"
              actions={
                <>
                  <Show when={n().offerLink}>
                    <Button onClick={() => void addStackCommand()}>Add stack command</Button>
                  </Show>
                  <IconButton label="dismiss" variant="ghost" onClick={dismissCliNote}>
                    <Icon name="x" size={14} />
                  </IconButton>
                </>
              }
            >
              <Rich text={n().text} />
            </Alert>
          )}
        </Show>
        <Show when={!config() && !bootError()}>
          <p class="empty">starting…</p>
        </Show>
        <Show when={config() && blocked()}>
          <StackSetup />
        </Show>
        <Show when={config() && !blocked() && step() === 'who'}>
          <WhoScreen />
        </Show>
        <Show when={config() && !blocked() && step() === 'project'}>
          <ProjectScreen />
        </Show>
        <Show when={config() && !blocked() && !step()}>
          <Switch>
            <Match when={view() === 'project'}>
              <Project scenario={hash().scenario} segs={segs()} />
            </Match>
            <Match when={view() === 'browse'}>
              <Browse scenario={hash().scenario} segs={segs()} />
            </Match>
            <Match when={true}>
              <NotFound scenario={hash().scenario} segs={segs()} />
            </Match>
          </Switch>
        </Show>
      </main>
        </div>
      </div>
    </div>
    <ToastRegion />
    <DialogHost />
    <Overlays />
    </>
  );
}
