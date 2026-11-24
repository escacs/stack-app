// Presets as a catalog kind: the rows Browse shows under "Presets". A preset
// is a named bundle of stack entries, so it reads like any other row (icon,
// name, `preset` kind text, a summary of what it bundles) with the same two
// buttons: Open lists the member entries and where each would land, Import
// opens the same Import plan dialog as every import (the preset's dry run,
// folded into the file-level plan) and confirms with `Import N`. The list
// and the plan/apply calls live in ../presets; this file is the view.
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { errText } from '../bridge';
import { Modal } from '../dialog';
import { Icon } from '../icons';
import { destLabel, type PresetListItem } from '../json';
import { toastFailure, toastOutcome } from '../mutations';
import { applyPreset, filterPresets, planPreset, presetSummary, presetsState } from '../presets';
import { recordImported } from '../remember';
import { config, lock, refreshLock, refreshReport } from '../store';
import { t3Info } from '../t3';
import { presetOutcome } from '../undo';
import { Button, CliErr } from '../ui';
import { LABEL } from '../vocab';
import { ImportPlan, type PlanView } from './ImportPlan';

type Planned = { name: string; view: PlanView; running: boolean; failure: string | null };

export function PresetList(props: {
  query: string;
  /** Another import is running: Import waits. */
  busy: boolean;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const [open, setOpen] = createSignal<string | null>(null);
  const [planned, setPlanned] = createSignal<Planned | null>(null);
  let gen = 0;
  const have = createMemo(() => new Set(lock().rows.map((r) => r.id)));
  const rows = createMemo(() => filterPresets(presetsState().presets, props.query));
  const imported = (p: PresetListItem): boolean => p.imports.length > 0 && p.imports.every((i) => have().has(i.id));
  const branch = (): string => t3Info()?.worktrees.find((w) => w.isCurrent)?.branch ?? 'project';

  async function openPlan(p: PresetListItem): Promise<void> {
    const c = config();
    if (!c?.project || props.busy || imported(p)) return;
    const mine = ++gen;
    setPlanned({ name: p.name, view: { phase: 'loading' }, running: false, failure: null });
    try {
      const plan = await planPreset({ project: c.project, stackPath: c.stackPath }, p.name);
      if (mine !== gen) return;
      setPlanned((cur) => (cur && cur.name === p.name ? { ...cur, view: { phase: 'ready', plan } } : cur));
    } catch (err) {
      if (mine !== gen) return;
      setPlanned((cur) => (cur && cur.name === p.name ? { ...cur, view: { phase: 'error', text: errText(err) } } : cur));
    }
  }
  const cancel = (): void => {
    gen++;
    setPlanned(null);
  };

  async function confirm(): Promise<void> {
    const s = planned();
    const c = config();
    if (!s || !c?.project || s.running || props.busy) return;
    const ctx = { project: c.project, stackPath: c.stackPath };
    setPlanned({ ...s, running: true, failure: null });
    props.onBegin();
    try {
      const r = await applyPreset(ctx, s.name);
      toastOutcome(presetOutcome(r), ctx);
      recordImported(c.project, r.imported.map((p) => p.id));
      setPlanned(null);
      await refreshLock();
      await refreshReport();
    } catch (err) {
      toastFailure(`Could not import preset ${s.name}`, err);
      setPlanned((cur) => (cur && cur.name === s.name ? { ...cur, running: false, failure: errText(err) } : cur));
    } finally {
      props.onEnd();
    }
  }

  const ready = () => {
    const v = planned()?.view;
    return v?.phase === 'ready' ? v.plan : null;
  };

  return (
    <>
      <Show when={presetsState().error}>{(e) => <CliErr text={e()} />}</Show>
      <Show
        when={rows().length}
        fallback={
          <div class="browse__empty">
            <p class="browse__empty-title">
              {!presetsState().loaded ? 'Loading presets…' : props.query.trim() ? `No presets match “${props.query.trim()}”` : 'The stack has no presets'}
            </p>
          </div>
        }
      >
        <div id="entry-list" class="browse__rows presetrows" role="list" tabindex="0" aria-label={`Presets, ${rows().length}`}>
          <For each={rows()}>
            {(p) => (
              <div class="preset" role="listitem">
                <div class="erow" title={p.description || p.name}>
                  <span class="erow__lead">
                    <span class="sp" aria-hidden="true">
                      <Icon name="box" size={15} />
                    </span>
                  </span>
                  <span class="erow__main">
                    <span class="erow__name">
                      <span class="erow__nm">{p.name}</span>
                    </span>
                    <span class="erow__lib">preset</span>
                  </span>
                  <span class="erow__sum" title={p.description}>
                    {presetSummary(p)}
                    <Show when={p.description}> · {p.description}</Show>
                  </span>
                  <span class="erow__acts">
                    <Button
                      class="erow__open"
                      size="sm"
                      variant="ghost"
                      aria-label={`Open ${p.name}`}
                      aria-expanded={open() === p.name}
                      title="Show the entries this preset bundles and where they land"
                      onClick={() => setOpen((cur) => (cur === p.name ? null : p.name))}
                    >
                      <span class="erow__open-t">{open() === p.name ? 'Close' : 'Open'}</span>
                      <Icon name="chevronDown" size={14} class="erow__open-i" />
                    </Button>
                    <Show when={!imported(p)} fallback={<span class="erow__imported" title="Every entry is already in this project">Imported ✓</span>}>
                      <Button
                        size="sm"
                        aria-label={`Import ${p.name}`}
                        disabled={props.busy || !p.imports.length}
                        title={props.busy ? 'Another operation is running' : 'Review the files this preset would write, then import its entries'}
                        onClick={() => void openPlan(p)}
                      >
                        {LABEL.importAction}
                      </Button>
                    </Show>
                  </span>
                </div>
                <Show when={open() === p.name}>
                  <div class="preset__panel" role="region" aria-label={`${p.name} entries`}>
                    <Show when={p.description}>
                      <p class="preset__desc">{p.description}</p>
                    </Show>
                    <ul class="preset__members">
                      <For each={p.imports}>
                        {(i) => (
                          <li>
                            <span class="preset__id">{i.id}</span>
                            <span class="preset__to" title={i.to ? `writes into ${i.to}` : 'the catalog’s default destination'}>
                              → {i.to ? destLabel(i.to) : 'catalog default destination'}
                            </span>
                            <Show when={have().has(i.id)}>
                              <span class="preset__here">already imported</span>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={planned()}>
        {(s) => (
          <Portal>
            <Modal onClose={() => !s().running && cancel()}>
              <div class="sa-dialog__content browse__plandlg" role="dialog" aria-modal="true" aria-label="Import plan" tabindex="-1" data-modal-content>
                <ImportPlan
                  title={LABEL.importPlan}
                  subject={`preset ${s().name} · ${LABEL.importInto(branch())}`}
                  view={s().view}
                  confirmLabel={LABEL.importAction}
                  counted
                  already={ready()?.already}
                  busy={s().running}
                  failure={s().failure}
                  onConfirm={() => void confirm()}
                  onCancel={cancel}
                />
              </div>
            </Modal>
          </Portal>
        )}
      </Show>
    </>
  );
}
