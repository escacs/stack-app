// Website browse units, ported from stack/web/app.js for the desktop
// Browse view. Names, weights and structure stay recognizable so the two
// can be diffed by eye. Deviations forced by Solid are marked PORT:
// JSX replaces h(), text is auto-escaped, entry links point at app hash
// routes, and file bodies/images arrive via show --file instead of URLs.
import type { JSX } from 'solid-js';
import { KINDS } from './parse';
import type { EntryLibrary, JsonEntry } from './json';

// ------------------------------------------------------------------ glyphs

/** Per-kind sprite, filled = custom, hollow = imported. */
export const SPRITE: Record<string, [string, string]> = {
  skill: ['★', '☆'], /* taste-skill-ignore: ascii sprite, font-variant-emoji text */
  style: ['●', '○'],
  system: ['■', '□'],
  component: ['◆', '◇'],
  library: ['▶', '▷'],
  asset: ['♥', '♡'], /* taste-skill-ignore: ascii sprite, font-variant-emoji text */
  template: ['▲', '△'],
  worker: ['☻', '☺'], /* taste-skill-ignore: ascii sprite, font-variant-emoji text */
};

/** Status as a face. */
export const FACE: Record<string, string> = {
  stable: '(^_^)',
  experimental: '(o_O)',
  deprecated: '(x_x)',
};

export function Sprite(props: { kind: string; origin?: string }) {
  const pair = SPRITE[props.kind] ?? ['·', '·'];
  return (
    <span class="sp" aria-hidden="true">
      {props.origin === 'imported' ? pair[1] : pair[0]}
    </span>
  );
}

export function Face(props: { status: string }) {
  return (
    <span class={`face ${props.status ?? ''}`} title={props.status}>
      {FACE[props.status] ?? '(-_-)'}
    </span>
  );
}

const STATUSES = ['stable', 'experimental', 'deprecated'];
const ORIGINS = ['custom', 'imported'];

/** Home legend: status faces with counts, then origin sprites, like the web. */
export function Legend(props: { entries: JsonEntry[] }) {
  const status: Record<string, number> = {};
  const origin: Record<string, number> = {};
  for (const e of props.entries) {
    status[e.status] = (status[e.status] ?? 0) + 1;
    origin[e.origin] = (origin[e.origin] ?? 0) + 1;
  }
  const key = (mark: JSX.Element, label: string, n: number) => (
    <span class="key">
      {mark}
      <span>{label}</span>
      <b>{n}</b>
    </span>
  );
  return (
    <div class="legend">
      <div>{STATUSES.map((st) => key(<Face status={st} />, st, status[st] ?? 0))}</div>
      <div>{ORIGINS.map((o) => key(<Sprite kind="skill" origin={o} />, o, origin[o] ?? 0))}</div>
    </div>
  );
}

/** Ascii bar cells: filled in ink, the rest dim (min 1 when n > 0). */
export function barCells(n: number, max: number, cells = 20): { on: number; off: number } {
  const on = n ? Math.max(1, Math.round((n / Math.max(max, 1)) * cells)) : 0;
  return { on, off: cells - on };
}

export function Bar(props: { n: number; max: number }) {
  const c = barCells(props.n, props.max);
  return (
    <span class="bar" aria-hidden="true">
      <span class="on">{'█'.repeat(c.on)}</span>
      <span class="off">{'·'.repeat(c.off)}</span>
    </span>
  );
}

export const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;

/** data: URL mime for a preview/image filename. */
export function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png' || ext === 'gif' || ext === 'webp' || ext === 'avif' || ext === 'ico') {
    return `image/${ext}`;
  }
  return 'application/octet-stream';
}

// ------------------------------------------------------------------ search

/**
 * Ranked client-side search, same weights as the website: name 5, tags 3,
 * id 2, summary 2, targets 1, id tiebreak. Zero-score rows drop out.
 */
export function scoreEntries(entries: JsonEntry[], query: string): JsonEntry[] {
  const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!toks.length) return entries;
  return entries
    .map((e) => {
      const f: [string | undefined, number][] = [
        [e.name, 5],
        [e.tags.join(' '), 3],
        [e.id, 2],
        [e.summary, 2],
        [e.targets.join(' '), 1],
      ];
      let n = 0;
      for (const t of toks) for (const [text, w] of f) if (text?.toLowerCase().includes(t)) n += w;
      return [n, e] as const;
    })
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id))
    .map(([, e]) => e);
}

/** Entries whose requires/related cite this id. */
export function citedBy(entries: JsonEntry[], id: string): string[] {
  return entries
    .filter((e) => [...(e.requires ?? []), ...(e.related ?? [])].includes(id))
    .map((e) => e.id);
}

// ------------------------------------------------------------------ kind rollup

export type KindStat = { kind: string; n: number; files: number; bytes: number };

/** Per-kind counts/sizes in KINDS order (zero kinds kept), plus totals. */
export function kindAgg(entries: JsonEntry[]): {
  stats: KindStat[];
  total: number;
  files: number;
  bytes: number;
} {
  const stats = KINDS.map((kind) => {
    const rows = entries.filter((e) => e.kind === kind);
    return {
      kind,
      n: rows.length,
      files: rows.reduce((a, e) => a + e.files, 0),
      bytes: rows.reduce((a, e) => a + e.bytes, 0),
    };
  });
  return {
    stats,
    total: entries.length,
    files: stats.reduce((a, s) => a + s.files, 0),
    bytes: stats.reduce((a, s) => a + s.bytes, 0),
  };
}

// ------------------------------------------------------------------ library groups

export type LibraryGroup = { lib: EntryLibrary; members: JsonEntry[] };

/**
 * Group components by their `library` block for the components kind view:
 * one group per library, the default library first, the rest by name;
 * members keep catalog order. Components outside a known library (no block)
 * come back in `ungrouped`, rendered as plain rows after the groups.
 */
export function groupComponents(entries: JsonEntry[]): {
  groups: LibraryGroup[];
  ungrouped: JsonEntry[];
} {
  const byName = new Map<string, LibraryGroup>();
  const ungrouped: JsonEntry[] = [];
  for (const e of entries) {
    if (!e.library) {
      ungrouped.push(e);
      continue;
    }
    const g = byName.get(e.library.name);
    if (g) g.members.push(e);
    else byName.set(e.library.name, { lib: e.library, members: [e] });
  }
  const groups = [...byName.values()].sort(
    (a, b) => Number(b.lib.default) - Number(a.lib.default) || a.lib.name.localeCompare(b.lib.name),
  );
  return { groups, ungrouped };
}

/** Header meta line for one library group: count plus extends/default markers. */
export function libraryMeta(lib: EntryLibrary, count: number): string {
  const bits = [`${count} member${count === 1 ? '' : 's'}`];
  if (lib.default) bits.push('default');
  if (lib.extends) bits.push(`extends ${lib.extends}`);
  return bits.join(' · ');
}

// ------------------------------------------------------------------ file tree

export type TreeFile = { path: string; size: number };

interface TreeNode {
  __file?: TreeFile;
  [k: string]: TreeNode | TreeFile | undefined;
}

/** File paths in tree-walk order (files before dirs, locale names). */
export function fileRowOrder(files: TreeFile[]): string[] {
  const root: TreeNode = {};
  for (const f of files) {
    let n = root;
    for (const part of f.path.split('/')) n = (n[part] ??= {}) as TreeNode;
    n.__file = f;
  }
  const out: string[] = [];
  const walk = (n: TreeNode): void => {
    const names = Object.keys(n)
      .filter((k) => k !== '__file')
      .sort(
        (a, b) =>
          ((n[b] as TreeNode | undefined)?.__file ? 0 : 1) -
            ((n[a] as TreeNode | undefined)?.__file ? 0 : 1) || a.localeCompare(b),
      );
    for (const name of names) {
      const c = n[name] as TreeNode;
      if (c.__file) out.push(c.__file.path);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/**
 * Nested file tree, like the website's tree(): header line, files before
 * dirs, ascii branches with │ continuation, sizes right-aligned.
 * PORT: keyboard selection covers tree files only (meta/preview links are
 * click-only); the web walks every data-nav link.
 */
export function FileTree(props: {
  files: TreeFile[];
  name: string;
  cur: string | null;
  sel: number;
  selBase: number;
  fileHref: (path: string) => string;
  fmtSize: (n: number) => string;
}) {
  const root: TreeNode = {};
  for (const f of props.files) {
    let n = root;
    for (const part of f.path.split('/')) n = (n[part] ??= {}) as TreeNode;
    n.__file = f;
  }
  const order = new Map(fileRowOrder(props.files).map((p, i) => [p, props.selBase + i] as const));
  const render = (n: TreeNode, prefix: string): JSX.Element[] => {
    const out: JSX.Element[] = [];
    const names = Object.keys(n)
      .filter((k) => k !== '__file')
      .sort(
        (a, b) =>
          ((n[b] as TreeNode | undefined)?.__file ? 0 : 1) -
            ((n[a] as TreeNode | undefined)?.__file ? 0 : 1) || a.localeCompare(b),
      );
    names.forEach((name) => {
      const c = n[name] as TreeNode;
      const last = name === names[names.length - 1];
      const branch = `${prefix}${last ? '└─ ' : '├─ '}`;
      if (c.__file) {
        const f = c.__file;
        const i = order.get(f.path) ?? props.selBase;
        out.push(
          <a
            class={`tl${f.path === props.cur ? ' cur' : ''}`}
            href={props.fileHref(f.path)}
            data-row={i}
            data-nav=""
            data-sel={props.sel === i ? '' : undefined}
          >
            <span class="br">{branch}</span>
            <span class="tn">{name}</span>
            <span class="sz">{props.fmtSize(f.size)}</span>
          </a>,
        );
      } else {
        out.push(
          <div class="tl dimtxt">
            <span class="br">{branch}</span>
            <span class="tn">{`${name}/`}</span>
          </div>,
        );
        out.push(...render(c, prefix + (last ? '   ' : '│  ')));
      }
    });
    return out;
  };
  return (
    <div class="tree">
      <div class="tl dimtxt">{`${props.name}/`}</div>
      {render(root, '')}
    </div>
  );
}

// ------------------------------------------------------------------ markdown

type MdLink =
  | { kind: 'entry'; id: string; file: string | null }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

const SAFE_URL = /^(https?:|mailto:|#)/i;

/**
 * Resolve a markdown link target, like the website's linkFor(): relative
 * paths resolve against the doc dir and route in-app when they land inside
 * a known entry; safe URLs pass through. PORT improvements: bare entry ids
 * (even ../-prefixed, with a file tail) match before relative resolution,
 * where the web would link a missing file under the current entry; and
 * blocked schemes render as plain text instead of a live href.
 */
export function mdLink(entries: JsonEntry[], entryId: string, file: string, u: string): MdLink {
  if (SAFE_URL.test(u)) return { kind: 'external', url: u };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return { kind: 'none' };
  const target = u.split('#')[0] ?? '';
  const matchEntry = (path: string): MdLink | null => {
    const ids = entries.map((e) => e.id).sort((a, b) => b.length - a.length);
    for (const id of ids) {
      if (path === id) return { kind: 'entry', id, file: null };
      if (path.startsWith(`${id}/`)) return { kind: 'entry', id, file: path.slice(id.length + 1) || null };
    }
    return null;
  };
  return (
    matchEntry(target) ??
    matchEntry(target.replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '')) ??
    (() => {
      const baseDir = `${entryId}/${file}`.split('/').slice(0, -1).join('/');
      const out: string[] = [];
      for (const seg of `${baseDir}/${target}`.split('/')) {
        if (seg === '..') out.pop();
        else if (seg && seg !== '.') out.push(seg);
      }
      return matchEntry(out.join('/')) ?? { kind: 'none' };
    })()
  );
}

const INLINE =
  /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g;

/**
 * Small markdown renderer, ported block for block from the website's
 * markdown(). PORT: JSX output; `![alt](src)` renders as a link exactly
 * like the web (its inline grammar has no image rule).
 */
export function Markdown(props: {
  text: string;
  entryId: string;
  file: string;
  entries: JsonEntry[];
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
}) {
  const inline = (s: string): JSX.Element => {
    const out: JSX.Element[] = [];
    let last = 0;
    // PORT: fresh regex per call (the shared global one keeps lastIndex).
    const re = new RegExp(INLINE.source, INLINE.flags);
    for (const m of s.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push(<span>{s.slice(last, idx)}</span>);
      if (m[2] != null) out.push(<code>{m[2]}</code>);
      else if (m[3] != null || m[4] != null) out.push(<strong>{inline(m[3] ?? m[4] ?? '')}</strong>);
      else if (m[5] != null) {
        const l = mdLink(props.entries, props.entryId, props.file, m[6] ?? '');
        if (l.kind === 'external') {
          out.push(
            <a href={l.url} target={l.url.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">
              {inline(m[5])}
            </a>,
          );
        } else if (l.kind === 'entry') {
          out.push(
            <a href={l.file ? props.fileHref(l.id, l.file) : props.entryHref(l.id)}>{inline(m[5])}</a>,
          );
        } else {
          out.push(<span>{m[5]}</span>);
        }
      } else out.push(<em>{inline(m[7] ?? m[8] ?? '')}</em>);
      last = idx + m[0].length;
    }
    if (last < s.length) out.push(<span>{s.slice(last)}</span>);
    return <>{out}</>;
  };

  const blocks = (): JSX.Element[] => {
    const src = props.text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
    const lines = src.split('\n');
    const out: JSX.Element[] = [];
    const isBlank = (l: string) => !l.trim();
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const special = (l: string) =>
      /^(#{1,6})\s/.test(l) ||
      /^```|^~~~/.test(l) ||
      /^>/.test(l) ||
      /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l) ||
      listRe.test(l) ||
      /^\|/.test(l);

    const list = (start: number): [JSX.Element, number] => {
      let i = start;
      const head = lines[i]?.match(listRe);
      const base = head?.[1].length ?? 0;
      const ordered = /\d/.test(head?.[2] ?? '');
      const items: JSX.Element[] = [];
      while (i < lines.length) {
        const m = lines[i]?.match(listRe);
        if (!m || (m[1] ?? '').length < base) break;
        if ((m[1] ?? '').length > base) {
          const [sub, next] = list(i);
          const lastItem = items[items.length - 1];
          // PORT: nested lists attach under the previous item via a sub-list
          // element rather than DOM appends.
          items[items.length - 1] = (
            <li>
              {lastItem} {sub}
            </li>
          );
          i = next;
          continue;
        }
        const chunks: JSX.Element[] = [inline(m[3] ?? '')];
        i++;
        while (
          i < lines.length &&
          !isBlank(lines[i] ?? '') &&
          !listRe.test(lines[i] ?? '') &&
          /^\s{2,}\S/.test(lines[i] ?? '')
        ) {
          chunks.push(<span> {inline((lines[i] ?? '').trim())}</span>);
          i++;
        }
        items.push(<li>{chunks}</li>);
        if (
          i < lines.length &&
          isBlank(lines[i] ?? '') &&
          listRe.test(lines[i + 1] ?? '') &&
          ((lines[i + 1] ?? '').match(listRe)?.[1].length ?? 0) >= base
        ) {
          i++;
        }
      }
      return [ordered ? <ol>{items}</ol> : <ul>{items}</ul>, i];
    };

    let i = 0;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (isBlank(l)) {
        i++;
        continue;
      }
      let m: RegExpMatchArray | null;
      if ((m = l.match(/^(```|~~~)/))) {
        const buf: string[] = [];
        i++;
        while (i < lines.length && !(lines[i] ?? '').startsWith(m[1] ?? '')) buf.push(lines[i++] ?? '');
        i++;
        out.push(
          <pre>
            <code>{buf.join('\n')}</code>
          </pre>,
        );
      } else if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
        const level = Math.min(m[1]?.length ?? 1, 4);
        const kids = inline(m[2] ?? '');
        out.push(
          level === 1 ? (
            <h1>{kids}</h1>
          ) : level === 2 ? (
            <h2>{kids}</h2>
          ) : level === 3 ? (
            <h3>{kids}</h3>
          ) : (
            <h4>{kids}</h4>
          ),
        );
        i++;
      } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) {
        out.push(<hr />);
        i++;
      } else if (l.startsWith('>')) {
        const buf: string[] = [];
        while (i < lines.length && (lines[i] ?? '').startsWith('>')) buf.push((lines[i++] ?? '').replace(/^>\s?/, ''));
        out.push(<blockquote>{inline(buf.join(' '))}</blockquote>);
      } else if (/^\|/.test(l) && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
        const cells = (r: string) =>
          r
            .trim()
            .replace(/^\||\|$/g, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|'));
        const headCells = cells(l);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && /^\|/.test(lines[i] ?? '')) rows.push(cells(lines[i++] ?? ''));
        out.push(
          <table>
            <thead>
              <tr>
                {headCells.map((c) => (
                  <th>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  {r.map((c) => (
                    <td>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      } else if (listRe.test(l)) {
        const [el, next] = list(i);
        out.push(el);
        i = next;
      } else {
        const buf: string[] = [];
        while (i < lines.length && !isBlank(lines[i] ?? '') && (buf.length === 0 || !special(lines[i] ?? ''))) {
          buf.push((lines[i++] ?? '').trim());
        }
        out.push(<p>{inline(buf.join(' '))}</p>);
      }
    }
    return out;
  };

  return <div class="doc">{blocks()}</div>;
}
