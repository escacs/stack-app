// Review changes: what an update would do to one tracked import, file by
// file, before it runs. The diff compares the installed file against the
// stack's current copy (`show --file`; the installed one is read through
// read_project_file). The CLI keeps only each file's hash of the original
// import, not its text, so a true three-way diff is not available: a file
// only upstream changed shows exactly what the update adds, a file only you
// edited shows your edits against the (unchanged) stack copy, and a file both
// sides changed is shown as two labelled versions side by side (Yours and
// Upstream), never as your lines deleted. Logic lives in ../diff (tested).
import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { errText, readProjectFile, stackRun } from '../bridge';
import { bothFiles, choiceOf, choicesFor, mergeFiles, setChoice } from '../choices';
import { bothSides, diffLines, diffStats, installedPathOf, modeCaption, reviewFiles, reviewHeadline, reviewMode, sideRows, sideStats, upstreamPathOf, type DiffOp, type ReviewMode } from '../diff';
import { fromStackOut, showFileArgs, toShowFile, type FileChoice, type ShowFileJson } from '../json';
import { editedOf, fmtBytes, missingOf, type StatusRow } from '../parse';
import { config } from '../store';
import { Alert, Button, Segmented } from '../ui';
import { DiffView } from './DiffView';

type FileReview =
  | { file: string; mode: ReviewMode; kind: 'diff'; ops: DiffOp[]; note?: string }
  | { file: string; mode: ReviewMode; kind: 'note'; note: string };

type Loaded = { phase: 'loading' } | { phase: 'error'; text: string } | { phase: 'ready'; files: FileReview[] };

// The badge words: a badge names the state ('Edited'); the longer 'You
// edited' stays inside sentences (the headline, the captions).
const MODE_WORD: Record<ReviewMode, string> = { upstream: 'Upstream changed', local: 'Edited', both: 'Both changed', missing: 'Deleted here' };

export const CONFLICT_NOTE = 'Conflict markers will be written where you both changed the same lines.';

/** The per-file choices for a file both sides changed (what each does, in words). */
export const CHOICE_OPTIONS: { value: FileChoice; label: string; title: string }[] = [
  { value: 'mine', label: 'Keep mine', title: 'Leave your version of this file untouched' },
  { value: 'upstream', label: 'Take upstream', title: 'Use the stack’s version; yours is saved next to it as <file>.mine' },
  { value: 'merge', label: 'Merge (conflict markers)', title: 'Merge both; where you changed the same lines the file gets <<<<<<< markers' },
];

async function reviewOne(
  c: { project: string; stackPath: string | null },
  row: StatusRow,
  payload: string | null,
  file: string,
  mode: ReviewMode,
): Promise<FileReview> {
  const [installed, up] = await Promise.all([
    readProjectFile(c.project, installedPathOf(row.path, file)).catch((e) => ({ error: errText(e) })),
    stackRun('show', showFileArgs(row.id, upstreamPathOf(file, payload)), c.project, c.stackPath).then(
      (out) => toShowFile(fromStackOut<ShowFileJson>(out)),
      () => null,
    ),
  ]);
  if ('error' in installed) return { file, mode, kind: 'note', note: `Could not read the installed file: ${installed.error}` };
  if (installed.binary || up?.binary) return { file, mode, kind: 'note', note: 'A binary file: it changed, but there are no lines to compare.' };
  if (installed.truncated) return { file, mode, kind: 'note', note: `Too large to compare here (${fmtBytes(installed.size)}).` };
  const have = installed.exists ? (installed.text ?? '') : null;
  const stackText = up ? up.text : null;
  if (have === null && stackText === null) return { file, mode, kind: 'note', note: 'Not in the project and not in the stack.' };
  if (stackText === null && up === null) {
    return { file, mode, kind: 'diff', ops: diffLines(have ?? '', ''), note: 'The stack no longer has this file; a merge removes it unless you edited it.' };
  }
  if (have === null) {
    // Deleted here (in the lock, gone from the project) is not a new upstream file.
    const note = mode === 'missing' ? 'Deleted here: this file is in the stack but not in your project. Its stack copy is shown below.' : 'New upstream file, not in your copy.';
    return { file, mode, kind: 'diff', ops: diffLines('', stackText ?? ''), note };
  }
  // Only-you-edited reads as your edits (stack copy → yours); the rest as what a merge brings (yours → stack).
  const ops = mode === 'local' ? diffLines(stackText ?? '', have) : diffLines(have, stackText ?? '');
  return { file, mode, kind: 'diff', ops };
}

export function ReviewChanges(props: {
  row: StatusRow;
  /** The entry's payload folder (templates), for mapping installed names to stack files. */
  payload: string | null;
  busy: boolean;
  onLoaded: (key: string) => void;
  onUpdate: () => void;
  /** Opens the dry-run preview of the update with the current per-file choices. */
  onPreview?: () => void;
  onClose: () => void;
  updateLabel: string;
  /** Inside the import detail: no card frame, no footer (the page owns the actions). */
  embedded?: boolean;
}) {
  const [state, setState] = createSignal<Loaded>({ phase: 'loading' });
  const up = () => props.row.upstream ?? [];
  const local = () => editedOf(props.row);
  const missing = () => missingOf(props.row);
  // Must match Project.tsx's rowKey: it is how the page knows this review was read.
  const key = () => `${props.row.id}|${props.row.commit}|${up().join(',')}|${props.row.local.join(',')}`;
  let gen = 0;
  onCleanup(() => gen++);

  createEffect(
    on(key, (k) => {
      const my = ++gen;
      const c = config();
      if (!c?.project) return;
      setState({ phase: 'loading' });
      const files = reviewFiles(up(), [...local(), ...missing()]);
      Promise.all(files.map((f) => reviewOne({ project: c.project as string, stackPath: c.stackPath }, props.row, props.payload, f, reviewMode(f, up(), local(), missing()) ?? 'upstream')))
        .then((res) => {
          if (my !== gen) return;
          setState({ phase: 'ready', files: res });
          props.onLoaded(k);
        })
        .catch((e) => {
          if (my === gen) setState({ phase: 'error', text: errText(e) });
        });
    }),
  );

  const head = () => reviewHeadline(up(), props.row.local, missing());
  const both = () => bothSides(up(), local());
  const bothList = () => bothFiles(up(), local());
  // Conflict markers are only a prospect while some both-changed file is still on Merge.
  const markersLeft = () => mergeFiles(bothList(), choicesFor(props.row.id)).length > 0;
  const ready = () => state().phase === 'ready';

  return (
    <section class="review" data-embedded={props.embedded ? '' : undefined} aria-label={`Review changes to ${props.row.id}`}>
      <div class="review__head">
        <ul class="review__facts">
          <Show when={head().upstream}>{(t) => <li class="review__fact" data-side="upstream">{t()}</li>}</Show>
          <Show when={head().local}>{(t) => <li class="review__fact" data-side="local">{t()}</li>}</Show>
        </ul>
      </div>
      <Show when={both()}>
        <Alert tone="warning" icon="alert" role="status">
          <span class="sa-alert__title">Both sides changed — review first</span>
          <span class="sa-alert__description">
            <Show
              when={markersLeft()}
              fallback={<>You chose how each of these files is settled. Nothing will be merged with conflict markers.</>}
            >
              Choose what happens to each file you both changed. {CONFLICT_NOTE}
            </Show>
          </span>
        </Alert>
      </Show>
      <Show when={state().phase === 'loading'}>
        <p class="review__loading" role="status">Reading the files…</p>
      </Show>
      <Show when={state().phase === 'error' ? (state() as { text: string }).text : null}>
        {(t) => (
          <Alert tone="error" icon="alert" role="alert">
            {t()}
          </Alert>
        )}
      </Show>
      <Show when={state().phase === 'ready' ? (state() as { files: FileReview[] }).files : null}>
        {(files) => (
          <div class="review__files">
            <For each={files()}>
              {(f, i) => {
                const stats = f.kind === 'diff' ? diffStats(f.ops) : null;
                const rows = f.kind === 'diff' ? sideRows(f.ops) : [];
                const sides = f.mode === 'both' ? sideStats(rows) : null;
                return (
                  <details class="review__file" open={i() === 0 || files().length <= 2 || f.mode === 'both'}>
                    <summary class="review__summary">
                      <span class="review__name">{f.file}</span>
                      <span class="review__mode" data-mode={f.mode}>{MODE_WORD[f.mode]}</span>
                      <Show
                        when={sides}
                        fallback={
                          <Show when={stats}>
                            {(s) => (
                              <span class="review__stats">
                                <span class="review__add" aria-label={`${s().added} lines added`}>+{s().added}</span>{' '}
                                <span class="review__del" aria-label={`${s().removed} lines removed`}>−{s().removed}</span>
                              </span>
                            )}
                          </Show>
                        }
                      >
                        {(s) => (
                          <span class="review__stats review__stats--side" title={`${s().yours} lines only in Yours, ${s().upstream} lines only in Upstream`}>
                            <span>{s().yours} yours</span> · <span>{s().upstream} upstream</span>
                          </span>
                        )}
                      </Show>
                    </summary>
                    <Show when={f.mode === 'both'}>
                      <div class="review__choice">
                        <span class="review__choice-label">For this file</span>
                        <Segmented
                          label={`What to do with ${f.file}`}
                          value={choiceOf(props.row.id, f.file)}
                          options={CHOICE_OPTIONS}
                          disabled={props.busy}
                          onChange={(v) => setChoice(props.row.id, f.file, v)}
                        />
                      </div>
                    </Show>
                    <p class="review__caption">{f.kind === 'diff' && f.note ? f.note : modeCaption(f.mode)}</p>
                    {f.kind === 'diff' ? (
                      <Show
                        when={f.ops.length}
                        fallback={
                          <Alert tone="neutral" role="status">No line differences.</Alert>
                        }
                      >
                        <DiffView
                          ops={f.ops}
                          label={`${MODE_WORD[f.mode]} ${f.file}`}
                          columns={f.mode === 'both' ? { left: 'Yours', right: 'Upstream' } : undefined}
                        />
                      </Show>
                    ) : (
                      <Alert tone="neutral" role="status">{f.note}</Alert>
                    )}
                  </details>
                );
              }}
            </For>
          </div>
        )}
      </Show>
      <Show when={ready() && (state() as { files: FileReview[] }).files.some((f) => f.mode === 'both')}>
        <Alert tone="info" icon="info" role="status">
          The original import is not kept, so a file both sides changed shows the two versions side by side instead of one edit.
        </Alert>
      </Show>
      <Show when={props.onPreview && both()}>
        <div class="review__preview">
          <Button disabled={props.busy || !ready()} onClick={() => props.onPreview?.()}>Preview</Button>
          <span class="dimtxt">See what updating would do to each file, without changing anything.</span>
        </div>
      </Show>
      <Show when={!props.embedded}>
        <div class="review__foot">
          <Button onClick={() => props.onClose()}>Close</Button>
          <Show when={up().length}>
            <div class="review__act">
              <Button variant={both() ? 'raised' : 'obsidian'} disabled={props.busy || !ready()} onClick={() => props.onUpdate()}>
                {props.updateLabel}
              </Button>
              <Show when={both() && markersLeft()}>
                <p class="review__consequence">{CONFLICT_NOTE}</p>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
