// Command palette (Cmd/Ctrl+K) and the shortcuts sheet (?). The palette is a
// combobox over a listbox: the input keeps focus, arrows move the highlight
// (aria-activedescendant), Enter runs, Esc closes, Tab stays inside, and
// focus returns to wherever it was. Commands come from commands.ts and run
// through the same functions the buttons use; ones that cannot run now are
// hidden (only "Go to X" keeps its reason). Styling is the vendored
// `sa-command` CSS, including its rule that hides a lone group label while
// filtering (it keys off data-query-active and data-slot="command-group").
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { commands, mac, type Command } from '../commands';
import { Modal } from '../dialog';
import { Icon } from '../icons';
import { helpOpen, paletteOpen, setHelpOpen, setPaletteOpen } from '../overlays';
import { groupRanked, isListed, rankCommands, segments, step, type Ranked } from '../palette';
import { formatCombo } from '../shortcuts';
import { Kbd } from '../ui';

export function Keys(props: { combo: Parameters<typeof formatCombo>[0] }) {
  return (
    <span class="sa-command__shortcut" data-slot="command-shortcut">
      <For each={formatCombo(props.combo, mac)}>{(k) => <Kbd>{k}</Kbd>}</For>
    </span>
  );
}

function PaletteSheet() {
  const uid = Math.random().toString(36).slice(2, 8);
  const [query, setQuery] = createSignal('');
  const [cursor, setCursor] = createSignal(0);
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;

  const groups = createMemo(() => groupRanked(rankCommands(commands(), query())));
  // Navigation order is the rendered (grouped) order.
  const flat = createMemo((): Ranked<Command>[] => groups().flatMap((g) => g.entries));
  const active = () => flat()[cursor()]?.item ?? null;

  // A new query starts at the top; the cursor stays valid as the list changes.
  createEffect(on(query, () => setCursor(0), { defer: true }));
  createEffect(() => {
    const n = flat().length;
    if (cursor() >= n) setCursor(Math.max(0, n - 1));
  });
  createEffect(() => {
    const a = active();
    if (a) list?.querySelector(`#${CSS.escape(`${uid}-${a.id}`)}`)?.scrollIntoView({ block: 'nearest' });
  });

  const close = () => setPaletteOpen(false);
  const run = (cmd: Command | null) => {
    if (!cmd || cmd.disabled) return;
    close();
    // After the palette unmounts and focus is back where it was.
    setTimeout(() => cmd.run(), 0);
  };

  const onKey = (ev: KeyboardEvent) => {
    const k = ev.key;
    if ((ev.metaKey || ev.ctrlKey) && k.toLowerCase() === 'k') {
      ev.preventDefault();
      // Closing unmounts the modal (and its keydown stopper) mid-dispatch; without
      // this the same keystroke reaches App's window handler and reopens the palette.
      ev.stopPropagation();
      close();
    } else if (k === 'ArrowDown' || (ev.ctrlKey && k === 'n')) {
      ev.preventDefault();
      setCursor((c) => step(c, 1, flat().length));
    } else if (k === 'ArrowUp' || (ev.ctrlKey && k === 'p')) {
      ev.preventDefault();
      setCursor((c) => step(c, -1, flat().length));
    } else if (k === 'Home' && !query()) {
      ev.preventDefault();
      setCursor(0);
    } else if (k === 'End' && !query()) {
      ev.preventDefault();
      setCursor(Math.max(0, flat().length - 1));
    } else if (k === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      run(active());
    }
  };

  return (
    <Modal onClose={close} initialFocus={() => input}>
      <div class="cmd-layer">
        <div
          class="sa-command"
          data-slot="command"
          data-query-active={query().trim() ? '' : undefined}
          data-modal-content
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div class="sa-command__input-wrap" data-slot="command-input-wrap">
            <Icon name="search" size={15} class="sa-command__search-icon" />
            <input
              ref={input}
              class="sa-command__input"
              data-slot="command-input"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${uid}-list`}
              aria-activedescendant={active() ? `${uid}-${active()!.id}` : undefined}
              aria-autocomplete="list"
              aria-label="Search commands"
              placeholder="Type a command or search…"
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              on:keydown={onKey}
            />
          </div>
          <div ref={list} class="sa-command__list" data-slot="command-list" id={`${uid}-list`} role="listbox" aria-label="Commands">
            <For each={groups()}>
              {(g) => (
                <div class="sa-command__group" data-slot="command-group" role="group" aria-labelledby={`${uid}-g-${g.group}`}>
                  <div class="sa-command__group-label" data-slot="command-group-label" id={`${uid}-g-${g.group}`}>
                    {g.group}
                  </div>
                  <For each={g.entries}>
                    {(r) => {
                      const idx = () => flat().indexOf(r);
                      return (
                        <div
                          id={`${uid}-${r.item.id}`}
                          class="sa-command__item"
                          data-slot="command-item"
                          role="option"
                          aria-selected={cursor() === idx()}
                          aria-disabled={r.item.disabled ? 'true' : undefined}
                          data-highlighted={cursor() === idx() ? '' : undefined}
                          data-disabled={r.item.disabled ? '' : undefined}
                          onPointerMove={() => cursor() !== idx() && setCursor(idx())}
                          onClick={() => run(r.item)}
                        >
                          <span class="sa-command__item-icon" data-slot="command-item-icon" aria-hidden="true">
                            <Icon name={r.item.icon} size={15} />
                          </span>
                          <span class="sa-command__item-text" data-slot="command-item-text">
                            <For each={segments(r.item.title, r.ranges)}>{(s) => (s.mark ? <mark>{s.text}</mark> : s.text)}</For>
                          </span>
                          <Show when={r.item.disabled}>
                            <span class="cmd-reason">{r.item.disabled}</span>
                          </Show>
                          <Show when={!r.item.disabled && r.item.hint}>
                            <span class="cmd-reason">{r.item.hint}</span>
                          </Show>
                          <Show when={r.item.shortcut}>{(sc) => <Keys combo={sc()} />}</Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
            <Show when={!flat().length}>
              <div class="sa-command__empty" data-slot="command-empty">No commands match “{query().trim()}”.</div>
            </Show>
          </div>
          <div class="sa-command__status" data-slot="command-status" role="status" aria-live="polite">
            <Show
              when={active()?.disabled}
              fallback={
                <span class="cmd-hints">
                  <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> run · <Kbd>Esc</Kbd> close
                </span>
              }
            >
              {(why) => <span>Unavailable: {why()}</span>}
            </Show>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Browse's own single-letter keys, listed for discovery (they live in Browse).
const BROWSE_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['↑↓', 'j', 'k'], label: 'Move the highlight and select that row' },
  { keys: ['Shift', '↑↓'], label: 'Extend the selection from where it started' },
  { keys: ['Ctrl', '↑↓'], label: 'Move the highlight without changing the selection' },
  { keys: ['Space'], label: 'Add or remove the highlighted row' },
  { keys: ['Click'], label: 'Select a row (double-click opens it)' },
  { keys: ['Ctrl', 'click'], label: 'Add or remove a row' },
  { keys: ['Shift', 'click'], label: 'Select the range from the last row clicked (Ctrl+Shift adds it)' },
  { keys: ['a'], label: 'Select every entry not yet imported (Ctrl+A too)' },
  { keys: ['↵'], label: 'Open the highlighted entry or folder' },
  { keys: ['i'], label: 'Import the selection, or the highlighted entry' },
  { keys: ['r'], label: 'Refresh the catalog' },
  { keys: ['Esc'], label: 'Clear the selection, then the search, then go up a level' },
];

function HelpSheet() {
  const close = () => setHelpOpen(false);
  let btn: HTMLButtonElement | undefined;
  const withKeys = () => commands().filter((c) => c.shortcut && isListed(c));
  return (
    <Modal onClose={close} initialFocus={() => btn}>
      <div class="sa-dialog__content help-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" data-modal-content>
        <div class="sa-dialog__header">
          <h2 class="sa-dialog__title">Keyboard shortcuts</h2>
          <p class="sa-dialog__description">
            <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>K</Kbd> opens the command palette and runs anything below by name.
          </p>
        </div>
        <div class="help-sheet__cols">
        <section aria-labelledby="hk-global">
          <h3 class="help-sheet__head" id="hk-global">Anywhere</h3>
          <dl class="help-sheet__list">
            <For each={withKeys()}>
              {(c) => (
                <div class="help-sheet__row">
                  <dt>{c.title}</dt>
                  <dd>
                    <Keys combo={c.shortcut!} />
                  </dd>
                </div>
              )}
            </For>
            <div class="help-sheet__row">
              <dt>Command palette</dt>
              <dd>
                <Keys combo={{ mod: true, key: 'k' }} />
              </dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="hk-browse">
          <h3 class="help-sheet__head" id="hk-browse">In Browse</h3>
          <dl class="help-sheet__list">
            <For each={BROWSE_KEYS}>
              {(r) => (
                <div class="help-sheet__row">
                  <dt>{r.label}</dt>
                  <dd>
                    <span class="sa-command__shortcut">
                      <For each={r.keys}>{(k) => <Kbd>{k}</Kbd>}</For>
                    </span>
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </section>
        </div>
        <div class="sa-dialog__footer">
          <button ref={btn} type="button" class="sa-dialog__close" onClick={close}>
            Close <span class="sa-dialog__shortcut">Esc</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Mounted once by App, beside the shell. */
export function Overlays() {
  return (
    <>
      <Show when={paletteOpen()}>
        <PaletteSheet />
      </Show>
      <Show when={helpOpen()}>
        <HelpSheet />
      </Show>
    </>
  );
}
