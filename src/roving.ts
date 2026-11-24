// One Tab stop per group of related controls: the current item (or the first)
// is the stop, the arrow keys, Home and End move between the group's items.
// Keeps the keyboard path to the content short without hiding any item from
// the arrows. Handled keys stop at the group so page hotkeys never see them.
type Axis = 'vertical' | 'horizontal' | 'both';

/** Solid `ref` callback factory: make the matching items of `root` a roving-tabindex group. */
export function rovingGroup(selector: string, axis: Axis = 'vertical') {
  return (root: HTMLElement): void => {
    const items = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)].filter((e) => !(e as HTMLButtonElement).disabled);
    const apply = (): void => {
      const its = items();
      if (!its.length) return;
      const stop = its.find((i) => i === document.activeElement) ?? its.find((i) => i.getAttribute('aria-current')) ?? its.find((i) => i.tabIndex === 0) ?? its[0];
      for (const i of its) {
        const want = i === stop ? 0 : -1;
        if (i.tabIndex !== want) i.tabIndex = want;
      }
    };
    new MutationObserver(apply).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-current'] });
    root.addEventListener('focusin', apply);
    root.addEventListener('keydown', (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const its = items();
      const i = its.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      const k = ev.key;
      const fwd = (axis !== 'horizontal' && k === 'ArrowDown') || (axis !== 'vertical' && k === 'ArrowRight');
      const back = (axis !== 'horizontal' && k === 'ArrowUp') || (axis !== 'vertical' && k === 'ArrowLeft');
      const next = fwd ? i + 1 : back ? i - 1 : k === 'Home' ? 0 : k === 'End' ? its.length - 1 : -2;
      if (next === -2) return;
      ev.preventDefault();
      ev.stopPropagation();
      its[Math.max(0, Math.min(its.length - 1, next))]?.focus();
    });
    queueMicrotask(apply);
  };
}

/** Sidebar nav items: one stop, up/down. */
export const roving = rovingGroup('a.sa-nav-item, button.sa-nav-item, .navgroup__sync', 'vertical');
/** Toolbar buttons (Browse filter/sort/import): one stop, left/right. Pickers keep Up/Down for their menu. */
export const rovingBar = rovingGroup('button:not(.skip-link)', 'horizontal');
