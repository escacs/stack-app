// Which stack_run subcommands skip the CLI's remote-cache network sync.
// `status --json` measured ~1s online vs ~95ms with --offline (the sync
// fetches every remote component library); show spawns once per row/file.
// `list` stays online so new remote members appear; writes stay online.
const OFFLINE_SUBS = new Set(['show', 'status']);

/** Append --offline for read subcommands that never need the network. */
export function withOffline(sub: string, args: string[]): string[] {
  if (!OFFLINE_SUBS.has(sub) || args.includes('--offline')) return args;
  // Before a `--` separator so it can never be read as a positional.
  const dd = args.indexOf('--');
  return dd < 0 ? [...args, '--offline'] : [...args.slice(0, dd), '--offline', ...args.slice(dd)];
}
