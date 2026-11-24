// A unified line diff: line numbers on both sides, a +/− gutter that is also
// spoken (colour is only a second cue), long unchanged runs folded behind a
// button, and horizontal scroll inside the diff alone. Files both sides
// changed render `columns` instead — two labelled versions side by side
// ("Yours" / "Upstream"), neutral styling, only the one-sided lines tinted:
// there is no original text to diff against, so no line is framed as removed.
// Logic lives in ../diff.
import { For, Show, createMemo, createSignal } from 'solid-js';
import { collapseDiff, diffStats, sideRows, sideStats, type DiffOp, type SideRow } from '../diff';

const SPOKEN = { add: 'added', del: 'removed', eq: 'unchanged' } as const;
const SIGN = { add: '+', del: '−', eq: ' ' } as const;

function Line(props: { op: DiffOp }) {
  return (
    <tr class="diff__row" data-kind={props.op.kind}>
      <td class="diff__no" aria-hidden="true">{props.op.oldNo ?? ''}</td>
      <td class="diff__no" aria-hidden="true">{props.op.newNo ?? ''}</td>
      <td class="diff__sign">
        <span aria-hidden="true">{SIGN[props.op.kind]}</span>
        <span class="visually-hidden">{SPOKEN[props.op.kind]}{props.op.text ? `, line ${props.op.newNo ?? props.op.oldNo}: ` : ', blank line'}</span>
      </td>
      <td class="diff__code"><code>{props.op.text || ' '}</code></td>
    </tr>
  );
}

/** One row of the two-column view: a line each side has, or one side only. */
function SideLine(props: { row: SideRow; left: string; right: string }) {
  const r = () => props.row;
  const yoursSpoken = () =>
    r().kind === 'upstream' ? `${props.left} does not have this line` : `${r().yours}, ${props.left}`;
  const upSpoken = () =>
    r().kind === 'yours' ? `${props.right} does not have this line` : `${r().upstream}, ${props.right}`;
  return (
    <tr class="diff__srow" data-kind={r().kind}>
      <td class="diff__no" aria-hidden="true">{r().yoursNo ?? ''}</td>
      <td class="diff__scol">
        <span class="visually-hidden">{r().yours || r().kind === 'upstream' ? `Line ${r().yoursNo ?? r().upstreamNo ?? ''}: ${yoursSpoken()}: ` : `Blank line ${r().yoursNo ?? ''}`}</span>
        <code>{r().yours || ' '}</code>
      </td>
      <td class="diff__no" aria-hidden="true">{r().upstreamNo ?? ''}</td>
      <td class="diff__scol">
        <span class="visually-hidden">{r().upstream || r().kind === 'yours' ? `Line ${r().upstreamNo ?? r().yoursNo ?? ''}: ${upSpoken()}: ` : `Blank line ${r().upstreamNo ?? ''}`}</span>
        <code>{r().upstream || ' '}</code>
      </td>
    </tr>
  );
}

export function DiffView(props: {
  ops: DiffOp[];
  label: string;
  /** Present (both sides changed): diff as "left | right" labelled columns. */
  columns?: { left: string; right: string };
}) {
  const blocks = createMemo(() => collapseDiff(props.ops));
  const stats = createMemo(() => diffStats(props.ops));
  const cols = () => props.columns;
  const rowsOf = (lines: DiffOp[]): SideRow[] => sideRows(lines);
  const colStats = createMemo(() => sideStats(rowsOf(props.ops)));
  const aria = () =>
    cols()
      ? `${props.label}: two versions, ${cols()?.left} has ${colStats().yours} lines only here, ${cols()?.right} has ${colStats().upstream} only on its side`
      : `${props.label}: ${stats().added} added, ${stats().removed} removed`;
  const [open, setOpen] = createSignal<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const lines = (b: { type: 'lines' | 'fold'; lines: DiffOp[] }) => (
    <Show
      when={cols()}
      fallback={<For each={b.lines}>{(op) => <Line op={op} />}</For>}
    >
      <For each={rowsOf(b.lines)}>{(r) => <SideLine row={r} left={cols()?.left as string} right={cols()?.right as string} />}</For>
    </Show>
  );
  return (
    <div
      class="diff"
      classList={{ 'diff--cols': !!cols() }}
      role="region"
      tabindex="0"
      aria-label={aria()}
    >
      <table class="diff__table" classList={{ 'diff__table--cols': !!cols() }}>
        <Show when={cols()}>
          <thead class="diff__shead">
            <tr>
              <th class="diff__no" aria-hidden="true" />
              <th class="diff__colhead" scope="col">{cols()?.left}</th>
              <th class="diff__no" aria-hidden="true" />
              <th class="diff__colhead" scope="col">{cols()?.right}</th>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={blocks()}>
            {(b, i) => (
              <Show
                when={b.type === 'fold'}
                fallback={lines(b)}
              >
                <Show
                  when={open().has(i())}
                  fallback={
                    <tr class="diff__fold">
                      <td colspan="4">
                        <button type="button" class="diff__foldbtn" aria-expanded="false" onClick={() => toggle(i())}>
                          Show {b.lines.length} unchanged {b.lines.length === 1 ? 'line' : 'lines'}
                        </button>
                      </td>
                    </tr>
                  }
                >
                  <tr class="diff__fold">
                    <td colspan="4">
                      <button type="button" class="diff__foldbtn" aria-expanded="true" onClick={() => toggle(i())}>
                        Hide {b.lines.length} unchanged {b.lines.length === 1 ? 'line' : 'lines'}
                      </button>
                    </td>
                  </tr>
                  {lines(b)}
                </Show>
              </Show>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
