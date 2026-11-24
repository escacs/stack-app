// Toasts, the stack-alabaster look: a Solid 1.9 twin of components/
// stack-alabaster/toast. It emits the same `sa-toast*` classes and data
// attributes the vendored toast.css reads (data-front, data-expanded,
// data-starting-style, data-ending-style, --toast-index / -offset / -height /
// -front-height / -stack-height / -count), so the CSS is used unchanged. The
// SDK's measuring, hover expansion, pause-on-hover and timers are done here.
// The region is a polite live region; every card has a quiet always-visible
// dismiss, and a card may carry one action (Undo).
import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { Icon, type IconName } from './icons';
import { enqueue, geometry, remove, type ToastItem, type ToastTone } from './toastQueue';
import { toastTtl } from './undo';
import { returnFocus } from './modal';

export type { ToastTone };
export type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  action?: ToastItem['action'];
  ttl?: number;
};

const [items, setItems] = createSignal<ToastItem[]>([]);
const [leaving, setLeaving] = createSignal<ReadonlySet<number>>(new Set());
const [heights, setHeights] = createSignal<Record<number, number>>({});
let nextId = 1;

const LEAVE_MS = 240;

/** How many toasts are showing (reactive). */
export const toastCount = (): number => items().length;

// Keyboard path: Alt+T pins the stack open and focuses the newest card's action;
// Tab then walks the cards (newest first), Esc folds the stack and hands focus back.
const [pinned, setPinned] = createSignal(false);
let region: HTMLElement | undefined;
let restoreTo: Element | null = null;

/** Focus the notification region: expand the stack and land on the newest Undo (else its dismiss button). */
export function focusToasts(): void {
  if (!region || !items().length) return;
  const active = document.activeElement;
  if (active && !region.contains(active)) restoreTo = active;
  setPinned(true);
  // Back cards turn inert-free once the stack is expanded; wait a frame for that.
  requestAnimationFrame(() => {
    const first = region?.querySelector<HTMLElement>('.sa-toast__action, .sa-toast__dismiss');
    first?.focus({ preventScroll: true });
  });
}

function leaveToasts(): void {
  const back = restoreTo && restoreTo !== document.body ? restoreTo : null;
  restoreTo = null;
  // Move focus out first: folding the stack makes the back cards inert, which would drop focus to <body>.
  if (region?.contains(document.activeElement)) returnFocus(back);
  setPinned(false);
}

/** Show a toast; returns its id. */
export function pushToast(input: ToastInput): number {
  const tone = input.tone ?? 'info';
  const item: ToastItem = {
    id: nextId++,
    tone,
    title: input.title,
    description: input.description,
    action: input.action,
    ttl: input.ttl ?? toastTtl(tone, !!input.action),
  };
  const { list, dropped } = enqueue(items(), item);
  setItems(list);
  for (const d of dropped) forget(d.id);
  return item.id;
}

function forget(id: number): void {
  setHeights((h) => {
    const { [id]: _gone, ...rest } = h;
    return rest;
  });
  setLeaving((s) => {
    const n = new Set(s);
    n.delete(id);
    return n;
  });
}

/** Animate a toast out, then drop it. */
export function dismissToast(id: number): void {
  if (leaving().has(id)) return;
  setLeaving((s) => new Set(s).add(id));
  setTimeout(() => {
    setItems((l) => remove(l, id));
    forget(id);
  }, LEAVE_MS);
}

const TONE_ICON: Record<ToastTone | 'default', IconName> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
  default: 'info',
};

function ToastCard(props: { item: ToastItem; index: number; offset: number; front: boolean; expanded: boolean; paused: boolean }) {
  const [entered, setEntered] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let el!: HTMLLIElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = props.item.ttl;
  let startedAt = 0;

  const measure = () => {
    // A collapsed back card is clipped to the front's height; scrollHeight is its real one.
    const h = el.scrollHeight;
    if (h && heights()[props.item.id] !== h) setHeights((m) => ({ ...m, [props.item.id]: h }));
  };

  onMount(() => {
    measure();
    // Two frames: the starting style must paint once before it releases.
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  // Pause on hover/focus, resume with what was left.
  createEffect(() => {
    if (props.paused) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        remaining -= Date.now() - startedAt;
      }
    } else if (!timer) {
      startedAt = Date.now();
      timer = setTimeout(() => dismissToast(props.item.id), Math.max(remaining, 800));
    }
  });
  onCleanup(() => timer && clearTimeout(timer));

  // A card tucked behind the front one is not reachable until the stack expands.
  createEffect(() => {
    el.toggleAttribute('inert', !props.front && !props.expanded);
  });

  const runAction = async () => {
    const a = props.item.action;
    if (!a || pending()) return;
    setPending(true);
    try {
      await a.run();
    } finally {
      dismissToast(props.item.id);
    }
  };

  return (
    <li
      ref={el}
      class="sa-toast"
      data-slot="toast"
      data-type={props.item.tone}
      data-front={props.front ? '' : undefined}
      data-expanded={props.expanded ? '' : undefined}
      data-starting-style={entered() ? undefined : ''}
      data-ending-style={leaving().has(props.item.id) ? '' : undefined}
      style={{
        '--toast-index': String(props.index),
        '--toast-offset': `${props.offset}px`,
        ...(heights()[props.item.id] ? { '--toast-height': `${heights()[props.item.id]}px` } : {}),
      }}
    >
      <span class={`sa-toast__icon sa-toast__icon--${props.item.tone}`} data-slot="toast-icon" data-type={props.item.tone} aria-hidden="true">
        <Icon name={TONE_ICON[props.item.tone]} size={16} />
      </span>
      <div class="sa-toast__body">
        <p class="sa-toast__title" data-slot="toast-title">{props.item.title}</p>
        <Show when={props.item.description}>
          <p class="sa-toast__description" data-slot="toast-description">{props.item.description}</p>
        </Show>
        <Show when={props.item.action}>
          {(a) => (
            <button type="button" class="sa-toast__action" data-pending={pending() ? '' : undefined} onClick={() => void runAction()}>
              {a().label}
            </button>
          )}
        </Show>
      </div>
      <button type="button" class="sa-toast__close sa-toast__dismiss" aria-label="Dismiss notification" title="Dismiss" onClick={() => dismissToast(props.item.id)}>
        <Icon name="x" size={12} />
      </button>
    </li>
  );
}

/** The one toast region, mounted once by App (outside the inert shell). */
export function ToastRegion() {
  const [hover, setHover] = createSignal(false);
  const [focus, setFocus] = createSignal(false);
  // Narrow layouts put the preview's actions at the bottom, so toasts ride the top instead.
  const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 899.98px)') : null;
  const [narrow, setNarrow] = createSignal(!!mq?.matches);
  onMount(() => {
    const on = () => setNarrow(!!mq?.matches);
    mq?.addEventListener('change', on);
    onCleanup(() => mq?.removeEventListener('change', on));
  });
  const expanded = () => hover() || focus() || pinned();
  const geo = () => geometry(items().map((t) => heights()[t.id]));
  return (
    <section
      ref={(el) => (region = el)}
      class="sa-toast-region"
      data-side={narrow() ? 'top' : 'bottom'}
      data-align={narrow() ? 'center' : 'start'}
      aria-keyshortcuts="Alt+T"
      data-expanded={expanded() && items().length > 1 ? '' : undefined}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      style={{
        '--toast-count': String(Math.max(items().length, 1)),
        '--toast-front-height': geo().frontHeight ? `${geo().frontHeight}px` : 'auto',
        '--toast-stack-height': `${geo().stackHeight}px`,
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      // Only keyboard focus holds the stack open: a toast button clicked with the mouse keeps focus, and would pause the timers for good.
      onFocusIn={(e) => setFocus((e.target as HTMLElement).matches?.(':focus-visible') ?? false)}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocus(false);
          setPinned(false);
          restoreTo = null;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          leaveToasts();
        }
      }}
    >
      <ol data-slot="toast-list" style={{ margin: '0', padding: '0', 'list-style': 'none' }}>
        <For each={items()}>
          {(item, i) => (
            <ToastCard
              item={item}
              index={i()}
              offset={geo().offsets[i()] ?? 0}
              front={i() === 0}
              expanded={expanded() && items().length > 1}
              paused={expanded()}
            />
          )}
        </For>
      </ol>
    </section>
  );
}
