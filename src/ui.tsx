// Shared bits: structured op results, state chips, git markers, errors.
import { placePicker } from './menuPlace';
import { For, Show, createSignal, createUniqueId, onCleanup, splitProps, type JSX } from 'solid-js';
import { Icon, type IconName } from './icons';
import { rovingGroup } from './roving';
import type { OpSection } from './json';
import { STATE_WORD } from './vocab';
import { humanizeCliError, humanizeOp, nameIds, type Human } from './humanize';

/** A sentence with `code` spans (folders, file names) rendered as <code>. */
export function Rich(props: { text: string }) {
  const parts = () => props.text.split(/`([^`]+)`/);
  return (
    <For each={parts()}>{(p, i) => (i() % 2 ? <code class="mono">{p}</code> : <>{p}</>)}</For>
  );
}

/** The raw CLI text, kept out of sight: a collapsed disclosure with the text in a mono block. */
export function TechDetails(props: { raw: string }) {
  return (
    <Show when={props.raw.trim()}>
      <details class="techdetails">
        <summary>Show technical details</summary>
        <pre class="raw">{props.raw}</pre>
      </details>
    </Show>
  );
}

/** Title, why, next step and the collapsed raw text (the inside of an error Alert). */
export function HumanBody(props: { human: Human; compact?: boolean }) {
  return (
    <>
      <span class="sa-alert__title">
        <Rich text={props.human.title} />
      </span>
      <Show when={!props.compact}>
        <span class="humanerr__detail">
          <Rich text={props.human.detail} />
        </span>
      </Show>
      <span class="humanerr__next">
        <Rich text={props.human.next} />
      </span>
      <TechDetails raw={props.human.raw} />
    </>
  );
}

/**
 * A failure in plain words: what went wrong, why, what to do next, an optional
 * primary action, and the raw text only inside the disclosure.
 */
export function ErrorAlert(props: { human: Human; retry?: () => void; tone?: 'error' | 'warning'; class?: string }) {
  const action = () => {
    const a = props.human.action;
    if (!a) return null;
    // The fallback's "Try again" only shows when the view can really retry.
    if (a.id === 'retry' && !props.retry) return null;
    return a.id === 'retry' && props.retry ? { ...a, run: props.retry } : a;
  };
  return (
    <Alert
      tone={props.tone ?? 'error'}
      icon="alert"
      role="alert"
      class={`humanerr${props.class ? ` ${props.class}` : ''}`}
      actions={
        <Show when={action()}>
          {(a) => (
            <Button size="sm" variant="obsidian" onClick={() => a().run()}>
              {a().label}
            </Button>
          )}
        </Show>
      }
    >
      <HumanBody human={props.human} />
    </Alert>
  );
}

/** CLI stderr, humanized: a sentence and a next step, the raw text behind a disclosure. */
export function CliErr(props: { text: string; subject?: string | null; retry?: () => void }) {
  return <ErrorAlert human={humanizeCliError(props.text, { subject: props.subject })} retry={props.retry} />;
}

/** One --json op result as titled plain sentences (no ids, flags or CLI text). */
export function OpResult(props: { sections: OpSection[]; label?: string }) {
  const sections = () => humanizeOp(props.sections);
  return (
    <div class="oplog">
      <Show when={props.label}>
        <h2>{nameIds(props.label as string)}</h2>
      </Show>
      <For each={sections()}>
        {(s) => (
          <Show
            when={s.tone === 'bad'}
            fallback={
              <div class="opsec">
                <p class={s.tone === 'dim' ? 'dimtxt' : undefined}>
                  <Rich text={s.title} />
                </p>
                <Show when={s.lines.length}>
                  <ul class="opsec__list">
                    <For each={s.lines}>{(l) => <li><Rich text={l} /></li>}</For>
                  </ul>
                </Show>
              </div>
            }
          >
            <Alert tone="error" role="alert">
              <span class="sa-alert__title">
                <Rich text={s.title} />
              </span>
              <Show when={s.lines.length}>
                <ul class="opsec__list">
                  <For each={s.lines}>{(l) => <li><Rich text={l} /></li>}</For>
                </ul>
              </Show>
              <Show when={s.next}>{(n) => <span class="humanerr__next">{n()}</span>}</Show>
            </Alert>
          </Show>
        )}
      </For>
    </div>
  );
}

/**
 * One plain-text state word for a tracked import (no capsule). Words are
 * states only: Synced, Update, Edited, Gone. Actions never reuse them.
 */
export { STATE_WORD };
export function Empty(props: { children?: JSX.Element }) {
  return <p class="empty">{props.children ?? 'nothing here'}</p>;
}

// ---- alabaster primitives ------------------------------------------------
// Solid 1.9 twins of the stack-alabaster components: same `sa-*` class names
// and data attributes as components/stack-alabaster/*, so the vendored CSS
// (src/styles/stack-alabaster) styles them unchanged.

export type ButtonVariant = 'raised' | 'obsidian' | 'ghost' | 'danger';

/** Tactile button. `variant="obsidian"` is the one primary action per screen. */
export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean },
) {
  const [own, rest] = splitProps(props, ['variant', 'size', 'loading', 'class', 'children', 'type']);
  const variant = () => own.variant ?? 'raised';
  const size = () => own.size ?? 'md';
  return (
    <button
      type={own.type ?? 'button'}
      {...rest}
      data-variant={variant()}
      data-size={size()}
      data-loading={own.loading ? '' : undefined}
      aria-busy={own.loading ? 'true' : undefined}
      class={`sa-button sa-button--${variant()} sa-button--${size()}${own.class ? ` ${own.class}` : ''}`}
    >
      {own.children}
    </button>
  );
}

/** Link that wears a button's look (navigation, never an action). */
export function LinkButton(
  props: JSX.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' },
) {
  const [own, rest] = splitProps(props, ['variant', 'size', 'class', 'children']);
  const variant = () => own.variant ?? 'raised';
  const size = () => own.size ?? 'md';
  return (
    <a
      {...rest}
      data-variant={variant()}
      data-size={size()}
      class={`sa-button sa-button--${variant()} sa-button--${size()}${own.class ? ` ${own.class}` : ''}`}
    >
      {own.children}
    </a>
  );
}

/** 32px raised icon button; `label` is its accessible name and tooltip. */
export function IconButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'raised' | 'ghost' | 'active' },
) {
  const [own, rest] = splitProps(props, ['label', 'variant', 'class', 'children', 'type']);
  const variant = () => own.variant ?? 'raised';
  return (
    <button
      type={own.type ?? 'button'}
      title={own.label}
      aria-label={own.label}
      {...rest}
      data-variant={variant()}
      class={`sa-icon-button sa-icon-button--${variant()} sa-icon-button--md${own.class ? ` ${own.class}` : ''}`}
    >
      <span class="sa-icon-button__icon" aria-hidden="true">
        {own.children}
      </span>
    </button>
  );
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export function Badge(props: { tone?: BadgeTone; size?: 'xs' | 'sm'; mono?: boolean; variant?: 'soft' | 'raised'; title?: string; children: JSX.Element }) {
  const tone = () => props.tone ?? 'neutral';
  const variant = () => props.variant ?? 'soft';
  const size = () => props.size ?? 'sm';
  return (
    <span
      data-slot="badge"
      data-tone={tone()}
      data-variant={variant()}
      data-size={size()}
      data-mono={props.mono ? '' : undefined}
      title={props.title}
      class={`sa-badge sa-badge--${tone()} sa-badge--variant-${variant()} sa-badge--${size()}${props.mono ? ' sa-badge--mono' : ''}`}
    >
      {props.children}
    </span>
  );
}

export function Kbd(props: { children: JSX.Element; class?: string }) {
  return (
    <kbd data-slot="kbd" class={`sa-kbd${props.class ? ` ${props.class}` : ''}`}>
      {props.children}
    </kbd>
  );
}

/** Recessed well / tray / footer surface. */
export function Well(props: { variant?: 'well' | 'tray' | 'footer'; class?: string; children: JSX.Element; 'aria-label'?: string }) {
  const v = () => props.variant ?? 'well';
  return (
    <div
      data-slot="well"
      data-variant={v()}
      aria-label={props['aria-label']}
      class={`sa-well sa-well--${v()}${props.class ? ` ${props.class}` : ''}`}
    >
      {props.children}
    </div>
  );
}

export type NavState = 'default' | 'selected' | 'target';
export type NavTone = 'default' | 'warning' | 'success' | 'info' | 'error';

/**
 * Sidebar source-list row, a link or a button. `selected` is the inspected
 * entry (white pill, aria-current), `target` the active worktree (recessed
 * well, blue icon, Target badge).
 */
export function NavItem(props: {
  label: string;
  state?: NavState;
  tone?: NavTone;
  icon?: JSX.Element;
  meta?: string;
  targetLabel?: string;
  href?: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const state = () => props.state ?? 'default';
  const tone = () => props.tone ?? 'default';
  const cls = () => `sa-nav-item sa-nav-item--${state()} sa-nav-item--tone-${tone()}`;
  const body = (
    <>
      <Show when={props.icon}>
        <span class="sa-nav-item__icon" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <span class="sa-nav-item__label">{props.label}</span>
      <Show
        when={state() === 'target'}
        fallback={
          <Show when={props.meta}>
            <span class="sa-nav-item__meta">{props.meta}</span>
          </Show>
        }
      >
        <Badge tone="info" size="xs">
          {props.targetLabel ?? 'Target'}
        </Badge>
      </Show>
    </>
  );
  return (
    <Show
      when={props.href}
      fallback={
        <button
          type="button"
          class={cls()}
          data-state={state()}
          data-tone={tone()}
          title={props.title}
          disabled={props.disabled}
          aria-current={state() === 'selected' ? 'page' : undefined}
          onClick={() => props.onClick?.()}
        >
          {body}
        </button>
      }
    >
      <a
        href={props.href}
        class={cls()}
        data-state={state()}
        data-tone={tone()}
        title={props.title}
        aria-current={state() === 'selected' ? 'page' : undefined}
      >
        {body}
      </a>
    </Show>
  );
}

/** Recessed track of link segments (`Project | Browse`); the current one is raised. */
export function SegmentedNav(props: { label: string; items: { key: string; label: string; href: string; badge?: number; badgeLabel?: string }[]; current: string; variant?: 'track' | 'sub' }) {
  return (
    <nav
      class={`sa-segmented-control sa-segmented-control--${props.variant ?? 'track'}`}
      aria-label={props.label}
      ref={(el) => {
        if ((props.variant ?? 'track') === 'track') rovingGroup('a.sa-segmented-control__item', 'horizontal')(el);
      }}
    >
      <For each={props.items}>
        {(it) => (
          <a
            href={it.href}
            class="sa-segmented-control__item"
            data-checked={props.current === it.key ? '' : undefined}
            aria-current={props.current === it.key ? 'page' : undefined}
            aria-label={it.badge ? it.badgeLabel : undefined}
          >
            {it.label}
            <Show when={it.badge}>
              <span class="navbadge" aria-hidden="true">{it.badge}</span>
            </Show>
          </a>
        )}
      </For>
    </nav>
  );
}

/** A small radio group of buttons (one choice of a few), in the segmented-control look. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const move = (ev: KeyboardEvent, i: number) => {
    const n = props.options.length;
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const next = (i + step + n) % n;
    props.onChange(props.options[next].value);
    queueMicrotask(() => ((ev.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus());
  };
  return (
    <div class="sa-segmented-control sa-segmented-control--track segmented" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(o, i) => (
          <button
            type="button"
            role="radio"
            class="sa-segmented-control__item"
            aria-checked={props.value === o.value}
            data-checked={props.value === o.value ? '' : undefined}
            tabindex={props.value === o.value ? 0 : -1}
            title={o.title}
            disabled={props.disabled}
            onClick={() => props.onChange(o.value)}
            onKeyDown={(ev) => move(ev, i())}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}

/** Compact alabaster callout: tone bar + icon, text, optional trailing actions. Results, notices, errors. */
export function Alert(props: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  icon?: IconName;
  role?: 'alert' | 'status';
  class?: string;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  const tone = () => props.tone ?? 'neutral';
  return (
    <div class={`sa-alert sa-alert--${tone()} sa-alert--compact${props.class ? ` ${props.class}` : ''}`} role={props.role}>
      <Show when={props.icon}>
        {(n) => (
          <span class="sa-alert__icon" aria-hidden="true">
            <Icon name={n()} size={16} />
          </span>
        )}
      </Show>
      <div class="sa-alert__content">{props.children}</div>
      <Show when={props.actions}>
        <span class="sa-alert__actions">{props.actions}</span>
      </Show>
    </div>
  );
}

export type PickerOption = { value: string; label: string; hint?: string; title?: string };

/**
 * Styled single-choice picker (a pill with a popover listbox) in place of a
 * native <select>. The pill shows the chosen label in full width up to a cap,
 * with the long detail in `hint`/`title`. Arrow keys, Home/End, Enter/Space
 * pick, Escape/Tab close; handled keys stop at the element so page-level
 * hotkeys (Browse's list cursor) never see them.
 */
export function Picker(props: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: JSX.Element;
  /** `ghost` is a text trigger ("Sort: Name"), `pill` the raised control. */
  variant?: 'pill' | 'ghost';
  /** Text before the chosen label in a ghost trigger ("Sort"). */
  prefix?: string;
  placement?: 'up' | 'down';
  title?: string;
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let btn: HTMLButtonElement | undefined;
  let list: HTMLUListElement | undefined;
  const cur = () => props.options.find((o) => o.value === props.value) ?? props.options[0];
  const onDoc = (ev: PointerEvent) => {
    const t = ev.target as Node;
    if (!list?.contains(t) && !btn?.contains(t)) close(false);
  };
  function show() {
    if (props.disabled || !props.options.length) return;
    setActive(Math.max(0, props.options.findIndex((o) => o.value === props.value)));
    setOpen(true);
    document.addEventListener('pointerdown', onDoc, true);
    queueMicrotask(() => {
      if (list && btn) placePicker(list, btn);
      list?.focus();
    });
  }
  function close(refocus: boolean) {
    setOpen(false);
    document.removeEventListener('pointerdown', onDoc, true);
    if (refocus) btn?.focus();
  }
  onCleanup(() => document.removeEventListener('pointerdown', onDoc, true));
  const pick = (i: number) => {
    const o = props.options[i];
    if (o) props.onChange(o.value);
    close(true);
  };
  const onListKey = (ev: KeyboardEvent) => {
    const n = props.options.length;
    const k = ev.key;
    if (k === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (k === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (k === 'Home') setActive(0);
    else if (k === 'End') setActive(n - 1);
    else if (k === 'Enter' || k === ' ') pick(active());
    else if (k === 'Escape') close(true);
    else if (k === 'Tab') {
      close(true);
      return;
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  return (
    <span class="sa-picker" data-variant={props.variant ?? 'pill'} data-placement={props.placement ?? 'up'}>
      <button
        type="button"
        ref={btn}
        class="sa-picker__btn"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={`${id}-list`}
        aria-label={`${props.label}: ${cur()?.label ?? ''}`}
        title={props.title ?? cur()?.title ?? cur()?.label}
        disabled={props.disabled}
        onClick={() => (open() ? close(false) : show())}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            ev.stopPropagation();
            show();
          }
        }}
      >
        <Show when={props.icon}>
          <span class="sa-picker__icon" aria-hidden="true">{props.icon}</span>
        </Show>
        <Show when={props.prefix}>
          <span class="sa-picker__prefix">{props.prefix}:</span>
        </Show>
        <span class="sa-picker__label">{cur()?.label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <Show when={open()}>
        <ul
          ref={list}
          id={`${id}-list`}
          class="sa-picker__list"
          role="listbox"
          tabindex="-1"
          aria-label={props.label}
          aria-activedescendant={`${id}-o${active()}`}
          onKeyDown={onListKey}
        >
          <For each={props.options}>
            {(o, i) => (
              <li
                id={`${id}-o${i()}`}
                role="option"
                class="sa-picker__opt"
                aria-selected={o.value === props.value}
                data-active={active() === i() ? '' : undefined}
                title={o.title}
                onPointerEnter={() => setActive(i())}
                onClick={() => pick(i())}
              >
                <span class="sa-picker__opt-label">{o.label}</span>
                <Show when={o.hint}>
                  <span class="sa-picker__opt-hint">{o.hint}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </span>
  );
}

export type FilterOption = { key: string; label: string; count: number };

/**
 * Ghost "Filter" trigger with a popover of checkable options (a multi-select
 * menu). Arrow keys move, Space/Enter toggle without closing, Escape/Tab close.
 * Handled keys stop at the element so Browse's list hotkeys never see them.
 */
export function FilterMenu(props: {
  label: string;
  options: FilterOption[];
  on: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let btn: HTMLButtonElement | undefined;
  let list: HTMLDivElement | undefined;
  const onDoc = (ev: PointerEvent) => {
    const t = ev.target as Node;
    if (!list?.contains(t) && !btn?.contains(t)) close(false);
  };
  function show() {
    setActive(0);
    setOpen(true);
    document.addEventListener('pointerdown', onDoc, true);
    queueMicrotask(() => list?.focus());
  }
  function close(refocus: boolean) {
    setOpen(false);
    document.removeEventListener('pointerdown', onDoc, true);
    if (refocus) btn?.focus();
  }
  onCleanup(() => document.removeEventListener('pointerdown', onDoc, true));
  const n = () => props.options.length;
  const onKey = (ev: KeyboardEvent) => {
    const k = ev.key;
    if (k === 'ArrowDown') setActive((a) => (a + 1) % n());
    else if (k === 'ArrowUp') setActive((a) => (a - 1 + n()) % n());
    else if (k === 'Home') setActive(0);
    else if (k === 'End') setActive(n() - 1);
    else if (k === 'Enter' || k === ' ') {
      const o = props.options[active()];
      if (o) props.onToggle(o.key);
    } else if (k === 'Escape') close(true);
    else if (k === 'Tab') {
      close(true);
      return;
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  const summary = () => {
    const on = props.options.filter((o) => props.on.has(o.key));
    return on.length === 0 ? '' : on.length === 1 ? on[0].label : `${on.length} on`;
  };
  return (
    <span class="sa-picker" data-variant="ghost" data-placement="down">
      <button
        type="button"
        ref={btn}
        class="sa-picker__btn"
        data-active={props.on.size ? '' : undefined}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={`${id}-menu`}
        aria-label={`${props.label}${summary() ? `: ${summary()}` : ''}`}
        onClick={() => (open() ? close(false) : show())}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            ev.stopPropagation();
            show();
          }
        }}
      >
        <Icon name="filter" size={13} />
        <span class="sa-picker__label">{props.label}</span>
        <Show when={summary()}>
          <span class="sa-picker__count">{summary()}</span>
        </Show>
        <Icon name="chevronDown" size={12} />
      </button>
      <Show when={open()}>
        <div
          ref={list}
          id={`${id}-menu`}
          class="sa-picker__list"
          role="menu"
          tabindex="-1"
          aria-label={props.label}
          aria-activedescendant={`${id}-o${active()}`}
          onKeyDown={onKey}
        >
          <For each={props.options}>
            {(o, i) => (
              <div
                id={`${id}-o${i()}`}
                role="menuitemcheckbox"
                class="sa-picker__opt sa-picker__opt--check"
                aria-checked={props.on.has(o.key)}
                data-active={active() === i() ? '' : undefined}
                onPointerEnter={() => setActive(i())}
                onClick={() => props.onToggle(o.key)}
              >
                <span class="sa-picker__box" aria-hidden="true">
                  <Show when={props.on.has(o.key)}>
                    <Icon name="tick" size={11} />
                  </Show>
                </span>
                <span class="sa-picker__opt-label">{o.label}</span>
                <span class="sa-picker__opt-n">{o.count}</span>
              </div>
            )}
          </For>
          <Show when={props.on.size}>
            <button type="button" class="sa-picker__clear" onClick={() => { props.onClear(); close(true); }}>
              Clear filters
            </button>
          </Show>
        </div>
      </Show>
    </span>
  );
}
