// Shared bits: structured op results, state chips, git markers, errors.
import { For, Show, type JSX } from 'solid-js';
import type { OpSection } from './json';

/** One --json op result as titled sections (replaces raw CLI text logs). */
export function OpResult(props: { sections: OpSection[]; label?: string }) {
  return (
    <div class="oplog">
      <Show when={props.label}>
        <h2>{props.label}</h2>
      </Show>
      <For each={props.sections}>
        {(s) => (
          <div class={`opsec${s.tone === 'bad' ? ' conflict' : ''}`}>
            <p class={s.tone === 'dim' ? 'dimtxt' : undefined}>{s.title}</p>
            <Show when={s.lines.length}>
              <pre class="raw">{s.lines.join('\n')}</pre>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/** CLI stderr surfaced verbatim (plain text, never parsed as data). */
export function CliErr(props: { text: string }) {
  return <pre class="raw conflict" role="alert">{props.text}</pre>;
}

export function Chip(props: { state: string }) {
  return <span class={`chip ${props.state}`}>{props.state}</span>;
}

/**
 * Git-state markers for a catalog entry: `not-committed` (absent from the
 * stack's HEAD commit, so import refuses it) and `uncommitted-in-stack`
 * (the stack worktree holds uncommitted changes for it; imports read the
 * committed state). Nothing renders when neither applies.
 */
export function Markers(props: { notCommitted: boolean; uncommittedInStack: boolean }) {
  return (
    <Show when={props.notCommitted || props.uncommittedInStack}>
      <span class="markers">
        <Show when={props.notCommitted}>
          <span class="marker bad" title="not in the stack's HEAD commit. import refuses it until it is committed">
            not-committed
          </span>
        </Show>
        <Show when={props.uncommittedInStack}>
          <span class="marker" title="the stack worktree holds uncommitted changes for this entry. imports read the committed state">
            uncommitted-in-stack
          </span>
        </Show>
      </span>
    </Show>
  );
}

export function Empty(props: { children?: JSX.Element }) {
  return <p class="empty">{props.children ?? '(._.) nothing here'}</p>;
}
