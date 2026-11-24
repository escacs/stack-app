// The Browse refresh button (in the prompt line after the search box, so the
// search width never changes) and the failed-reload alert row under the bar.
// The 'refreshed' confirmation goes to a polite live region and a toast, not
// the bar. Browse owns the state; this only renders it.
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { humanizeCliError, oneSentence } from '../humanize';

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
  return (
    <IconButton
      label={working() ? 'Refreshing the catalog…' : 'Refresh the catalog (r)'}
      variant="ghost"
      class="refreshbtn"
      data-working={working() ? '' : undefined}
      disabled={props.disabled || working()}
      onClick={() => props.onRefresh()}
    >
      <Icon name="refresh" size={15} />
    </IconButton>
  );
}

/** What a failed reload says, in plain words (the raw stderr stays in the title). */
export function refreshErrorText(err: string): string {
  return oneSentence(humanizeCliError(err));
}


