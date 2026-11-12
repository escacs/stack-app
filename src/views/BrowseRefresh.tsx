// The Browse refresh button and its result line. Lives in the prompt line
// after the search box, so it shows on every Browse view (home, kind,
// all, entry). Browse owns the state; this only renders it.
import { Show } from 'solid-js';
import { CliErr } from '../ui';

/** Working, a one-line result, or the stderr of a failed reload. */
export type RefreshState =
  | { phase: 'working' }
  | { phase: 'done'; line: string }
  | { phase: 'error'; err: string };

export function RefreshButton(props: {
  state: RefreshState | null;
  /** True while an import op runs: a reload mid-import would lie about markers. */
  disabled: boolean;
  onRefresh: () => void;
}) {
  const working = (): boolean => props.state?.phase === 'working';
  const line = (): string | null => {
    const s = props.state;
    return s?.phase === 'done' ? s.line : null;
  };
  const err = (): string | null => {
    const s = props.state;
    return s?.phase === 'error' ? s.err : null;
  };
  return (
    <>
      <span class="refreshbox">
        <button
          class="btn"
          disabled={props.disabled || working()}
          title="reload the catalog from the stack checkout (r)"
          aria-label="refresh the catalog"
          onClick={() => props.onRefresh()}
        >
          {working() ? 'refreshing…' : 'refresh'}
        </button>
        <Show when={line()}>
          {(t) => (
            <span class="dimtxt" role="status">
              {t()}
            </span>
          )}
        </Show>
      </span>
      <Show when={err()}>
        {(text) => (
          <div class="refresherr">
            <CliErr text={text()} />
          </div>
        )}
      </Show>
    </>
  );
}
