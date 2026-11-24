// Direct T3 Code thread injection for Browse EntryDetail: send the current
// entry's doc/prompt straight into an existing thread or start a new one,
// optionally importing the entry into the thread's workspace first (that, and
// the new thread's title / base ref / branch, sit behind the Options
// disclosure).
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import {
  errText,
  stackRun,
  t3SendThread,
  t3StartThread,
  type T3ThreadActionResult,
  type T3ThreadInfo,
} from '../bridge';
import { fromStackOut, importArgs, needsImportDest, type ImportJson, type JsonEntry, type ShowJson } from '../json';
import { config, lock, refreshLock, refreshReport } from '../store';
import {
  buildInjectionPrompt,
  refreshT3Workspace,
  t3Info,
  threadTargetDir,
  type InjectMode,
} from '../t3';
import { Alert, Button, CliErr, Picker, Well } from '../ui';
import { Icon } from '../icons';
import t3Logo from '../assets/t3-code.png';
import { isRunning, runGuarded, useAction } from '../actions';
import { pushToast } from '../toast';
import { toastFailure } from '../mutations';

const NEW_THREAD = '__new__';

/** Short secondary text for a thread: where it runs and its state. */
const threadHint = (t: T3ThreadInfo): string =>
  [t.branch ?? (t.worktreePath ? 'worktree' : 'main'), t.status].filter(Boolean).join(' · ');
/** Full thread / worktree info for a tooltip. */
const threadDetail = (t: T3ThreadInfo): string =>
  [t.title, [threadHint(t), t.model].filter(Boolean).join(' · '), t.worktreePath ?? ''].filter(Boolean).join('\n');

export function T3Inject(props: {
  entry: JsonEntry | null;
  id: string;
  committed: boolean;
  docText: string | null;
  onImported: () => void;
}) {
  const [target, setTarget] = createSignal<string>('');
  const [mode, setMode] = createSignal<InjectMode>('inline');
  const [newTitle, setNewTitle] = createSignal('');
  const [newWorktree, setNewWorktree] = createSignal('');
  const [newBranch, setNewBranch] = createSignal('');
  const [opts, setOpts] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [done, setDone] = createSignal<T3ThreadActionResult | null>(null);

  const info = () => t3Info();
  const threads = () => info()?.threads ?? [];

  // Default target: first active/recent thread when available, else + new thread.
  createEffect(() => {
    const list = threads();
    const cur = target();
    if (!cur) {
      setTarget(list.length ? list[0].threadId : NEW_THREAD);
    } else if (cur !== NEW_THREAD && !list.some((t) => t.threadId === cur)) {
      setTarget(list.length ? list[0].threadId : NEW_THREAD);
    }
  });

  // Reset status when navigating between entries.
  createEffect(() => {
    props.id;
    setDone(null);
    setErr(null);
  });

  // Where an import lands: the chosen thread's worktree branch, else the open project's.
  const branchLabel = (): string => selectedThread()?.branch ?? info()?.worktrees.find((w) => w.isCurrent)?.branch ?? 'the project';

  const selectedThread = createMemo<T3ThreadInfo | null>(() => {
    const id = target();
    if (!id || id === NEW_THREAD) return null;
    return threads().find((t) => t.threadId === id) ?? null;
  });

  const canImportIntoTarget = createMemo(() => {
    if (!props.committed) return false;
    // A brand-new git worktree ref doesn't exist on disk until t3 thread start creates it.
    if (target() === NEW_THREAD && newWorktree().trim()) return false;
    const e = props.entry;
    return !!e && !needsImportDest(e);
  });

  async function resolveDocBody(): Promise<string | null> {
    if (props.docText) return props.docText;
    const c = config();
    try {
      const out = await stackRun('show', [props.id, '--json'], c?.project ?? '.', c?.stackPath);
      return fromStackOut<ShowJson>(out).doc ?? null;
    } catch {
      return null;
    }
  }

  async function inject(): Promise<void> {
    const c = config();
    const ws = info();
    const e = props.entry;
    if (!c?.project || !ws || !e || sending()) return;

    setSending(true);
    setErr(null);
    setDone(null);
    try {
      const activeMode: InjectMode = mode() === 'workspace' && canImportIntoTarget() ? 'workspace' : 'inline';
      let importedDest: string | null = null;

      if (activeMode === 'workspace') {
        const destDir = threadTargetDir(selectedThread(), ws) ?? c.project;
        const alreadyInCurrent =
          destDir === c.project ? lock().rows.find((r) => r.id === e.id)?.path ?? null : null;
        if (alreadyInCurrent) {
          importedDest = alreadyInCurrent;
        } else {
          const impOut = await stackRun('import', importArgs(e.id, ''), destDir, c.stackPath);
          const imp = fromStackOut<ImportJson>(impOut);
          importedDest = imp.imported.find((x) => x.id === e.id)?.path ?? null;
          if (destDir === c.project) {
            await refreshLock();
            await refreshReport();
            props.onImported();
          }
        }
      }

      const docBody = activeMode === 'inline' ? await resolveDocBody() : null;
      const message = buildInjectionPrompt({
        entry: e,
        mode: activeMode,
        dest: importedDest,
        docBody,
      });

      const res =
        target() === NEW_THREAD
          ? await t3StartThread({
              projectDir: c.project,
              message,
              title: newTitle().trim() || `${e.id} via stack`,
              worktree: newWorktree().trim() || null,
              branch: newBranch().trim() || null,
            })
          : await t3SendThread(target(), message);

      setDone(res);
      // Sent into another tool: nothing here can take it back, so no Undo.
      pushToast({
        tone: 'success',
        title: `Sent ${e.id} to T3 Code`,
        description: target() === NEW_THREAD ? 'Started a new thread.' : (selectedThread()?.title ?? 'The thread was notified.'),
      });
      void refreshT3Workspace(c.project);
    } catch (e2) {
      setErr(errText(e2));
      toastFailure(`Could not send ${e.id}`, e2);
    } finally {
      setSending(false);
    }
  }

  // Palette / shortcut: the same send the button runs.
  const send = (): Promise<boolean> => runGuarded('send-thread', inject);
  const sendBusy = (): boolean => sending() || isRunning('send-thread');
  useAction('send-thread', {
    run: inject,
    guard: true,
    title: () => (props.entry ? `Send ${props.entry.name ?? props.entry.id} to T3 thread` : null),
    reason: () => {
      if (!props.entry) return 'The entry is still loading';
      return info()?.t3Available ? null : 'T3 Code is not available';
    },
  });

  return (
    <Show when={info()?.t3Available}>
      <Well variant="tray" class="t3tray t3inject" aria-label="Send to a T3 Code thread">
        {/* ONE line: title and hint left, the split button right. The import
            mode, thread title, base ref and branch live behind the
            disclosure (the small Options link), never on this row. */}
        <div class="t3tray__row">
          <div class="t3tray__info">
            <img class="t3tray__logo" src={t3Logo} alt="" width="30" height="30" aria-hidden="true" />
            <div class="t3tray__text">
              <div class="t3tray__title">Send to T3 Code thread</div>
              <div class="t3tray__sub">
                <span
                  class="t3tray__cap"
                  title={selectedThread() ? threadDetail(selectedThread() as T3ThreadInfo) : undefined}
                >
                  {mode() === 'workspace' && canImportIntoTarget()
                    ? `Imports into ${branchLabel()}, then sends`
                    : 'Sends this entry'}
                </span>
              </div>
            </div>
          </div>
          <div class="t3tray__controls">
            <button
              type="button"
              class="linklike t3tray__opts"
              aria-expanded={opts()}
              aria-controls="t3-opts"
              disabled={sending()}
              title="Import first, thread title, base branch"
              onClick={() => setOpts((o) => !o)}
            >
              Options
            </button>
            <span class="t3tray__split">
              <Picker
                label="T3 Code thread"
                prefix="To"
                value={target()}
                disabled={sending()}
                title={selectedThread() ? threadDetail(selectedThread() as T3ThreadInfo) : 'Pick a thread, or start a new one'}
                options={[
                  ...threads().map((t) => ({
                    value: t.threadId,
                    label: t.title,
                    hint: threadHint(t),
                    title: threadDetail(t),
                  })),
                  { value: NEW_THREAD, label: '+ New thread', hint: 'Start one in this project' },
                ]}
                onChange={setTarget}
              />
              <Button
                variant="obsidian"
                class="t3tray__send"
                disabled={sendBusy() || !props.entry}
                aria-busy={sendBusy()}
                data-pending={sendBusy() ? '' : undefined}
                title={target() === NEW_THREAD ? 'Start a new T3 Code thread with this entry' : `Send this entry to “${selectedThread()?.title ?? 'the thread'}”`}
                onClick={() => void send()}
              >
                {sendBusy() ? 'Sending…' : target() === NEW_THREAD ? 'Start thread' : 'Send to thread'}
                <Icon name="arrowUpRight" size={13} />
              </Button>
            </span>
          </div>
        </div>

        <Show when={opts()}>
          <div class="t3tray__rows t3new" id="t3-opts">
            <Show
              when={canImportIntoTarget()}
              fallback={<Alert tone="info" class="t3tray__rows-note">Send injects this entry as a prompt; nothing is written into {branchLabel()}.</Alert>}
            >
              <label class="t3opt">
                <span class="t3field__label">
                  Import it into {branchLabel()} first{' '}
                  <span class="t3field__opt">(optional)</span>
                </span>
                <span class="t3opt__hint">Import the entry into {branchLabel()} before notifying the thread.</span>
                <Button
                  size="sm"
                  data-pressed={mode() === 'workspace' ? '' : undefined}
                  aria-pressed={mode() === 'workspace'}
                  disabled={sending()}
                  title="Import the entry into the thread's workspace first, then notify the thread"
                  onClick={() => setMode((m) => (m === 'workspace' ? 'inline' : 'workspace'))}
                >
                  Import first
                </Button>
              </label>
            </Show>
            <Show when={target() === NEW_THREAD}>
              <label class="t3field">
                <span class="t3field__label">Thread title</span>
                <input
                  type="text"
                  value={newTitle()}
                  onInput={(ev) => setNewTitle(ev.currentTarget.value)}
                  placeholder={`${props.id} via stack`}
                  autocomplete="off"
                />
              </label>
              <label class="t3field">
                <span class="t3field__label">Base branch <span class="t3field__opt">(optional)</span></span>
                <input
                  type="text"
                  value={newWorktree()}
                  onInput={(ev) => setNewWorktree(ev.currentTarget.value)}
                  placeholder="main"
                  autocomplete="off"
                  spellcheck={false}
                />
              </label>
              <Show when={newWorktree().trim()}>
                <label class="t3field">
                  <span class="t3field__label">Branch name <span class="t3field__opt">(optional)</span></span>
                  <input
                    type="text"
                    value={newBranch()}
                    onInput={(ev) => setNewBranch(ev.currentTarget.value)}
                    placeholder="Defaults to the base ref's name"
                    autocomplete="off"
                    spellcheck={false}
                  />
                </label>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={err()}>{(m) => <CliErr text={m()} />}</Show>
        <Show when={done()}>
          {(r) => (
            <p class="t3tray__status dimtxt" role="status">
              {target() === NEW_THREAD ? 'Started' : 'Sent'} → {r().title ?? r().threadId}
              <Show when={r().link}>
                {(url) => (
                  <>
                    {' '}
                    <a class="linklike" href={url()} target="_blank" rel="noopener noreferrer">
                      Open in T3 Code
                    </a>
                  </>
                )}
              </Show>
            </p>
          )}
        </Show>
      </Well>
    </Show>
  );
}
