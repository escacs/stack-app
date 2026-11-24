// Dev-only mock of the Tauri bridge for the stack app flows. Loaded before
// the app bundle when verifying the UI in a plain browser (see app/README.md
// "UI verification without the native shell"). Never imported by app code,
// never bundled. All fixture data is invented.
//
// Hash shape: `#<scenario>,<route>` — the scenario is the part before the
// first comma (default: populated), the route after it belongs to the app.
// Bare `#empty` etc. still work (home route).
//
// Scenarios: empty, populated, no-node, conflicts, missing, lookalike,
// scan, noworker, noproject, bad-stack, fresh, many (15 presets, three
// imports), manyfresh (15 presets, no stack.toml), lots (36 presets),
// adopt0 (no adoptable folders), adopt1 (one), adopt3 (three, one differs),
// quickimport (one of each import case), batchimport (an
// eight-member component library plus an already-imported row and two
// collisions in the import plan), no-auth, no-cli, cli-foreign, cli-elsewhere, no-path,
// offline, dirty, locked, interrupted (failure modes: see the block above `const fx`).
// A `+update-available` or `+update-error` suffix on any scenario drives the
// footer updater fixture (e.g. `#populated+update-available,/project`):
// the former answers checks with 0.1.9 and fires the startup update event,
// the latter fails checks. A `+pick-<case>` suffix scripts the adopt folder
// picker: matching, differing, nomatch, multi, outside, cancel
// (e.g. `#adopt3+pick-differing,/project`). `+grows` arms `window.__mockGrow()`,
// which adds one skill to the catalog — call it after the first load, so the
// browse refresh visibly picks it up. `+listfail` arms
// `window.__mockFailLists()`, which fails later catalog lists, for the
// refresh error state. `+t3` populates mock T3 Code branch worktrees and
// threads (for testing worktree switching, sync-all, and thread injection).
// (Triggers, not counters: onboarding itself spends bare `list` calls before
// the first visible render.)
(() => {
  'use strict';

  const rawScenario = ((location.hash || '#populated').slice(1).split(',')[0] || '').split('/')[0] || 'populated';
  const [scenario, ...flags] = rawScenario.split('+');
  const t3Mode = flags.includes('t3') || scenario === 't3';
  // Footer updater fixture: 'available' offers 0.1.9 (check answers it and
  // the startup event fires), 'error' fails checks, otherwise up to date.
  const updaterMode = flags.includes('update-available')
    ? 'available'
    : flags.includes('update-error')
      ? 'error'
      : 'none';
  const UPDATE_VERSION = '0.1.9';
  // Adopt-picker fixture: `+pick-<case>` scripts what the native folder
  // dialog returns (the real shell returns a project-relative folder, null
  // on cancel, or rejects outside picks). Cases: matching (identical),
  // differing, nomatch, multi (two same-named entries), outside (rejects),
  // cancel. Without a flag the first adoptable folder answers, else a
  // non-matching folder.
  const pickFlag = (flags.find((f) => f.startsWith('pick-')) ?? '').slice('pick-'.length) || null;
  // Refresh fixtures, armed by scenario flag and fired by the check once
  // the first load has rendered (see the header comment).
  const extra = [];
  let listsFail = false;
  if (flags.includes('grows')) {
    window.__mockGrow = () => {
      if (!extra.length) {
        extra.push({ id: 'skills/fresh-skill', usage: 'link', status: 'experimental', summary: 'Appeared after the first catalog load (mock +grows fixture).' });
      }
    };
  }
  if (flags.includes('listfail')) {
    window.__mockFailLists = () => {
      listsFail = true;
    };
  }

  // ---------------------------------------------------------------- catalog
  // Rendered into the exact JSON shapes of tools/stack/cli.mjs --json (and
  // the legacy text shapes when --json is absent, which the app no longer
  // sends), so the app parses fixtures the way it parses the real CLI.

  const HEAD = 'b51359b';
  const FULL = `${HEAD}fffffffffffffffffffffffffffffffff`;

  const CATALOG = [
    { id: 'skills/file-pr', usage: 'link', status: 'stable', summary: 'File a concise pull request from the current branch.' },
    { id: 'skills/ponytail', usage: 'link', status: 'experimental', summary: 'Lazy senior dev mode: the smallest change that fully solves the task.' },
    { id: 'styles/folio-light', usage: 'link', status: 'stable', summary: 'Warm paper style with ink text and a single clay accent.' },
    { id: 'systems/engineering-conventions', usage: 'reference', status: 'stable', summary: 'How escacs code is organized, tested and reviewed.' },
    { id: 'components/react/button', usage: 'copy', status: 'experimental', summary: 'Button with variants, sizes and a loading state.', requires: ['components/react/icon-button'], library: { name: 'react', extends: null, default: true } },
    { id: 'components/react/icon-button', usage: 'copy', status: 'experimental', summary: 'Square icon-only action button.', library: { name: 'react', extends: null, default: true } },
    { id: 'components/stack-alabaster/panel', usage: 'copy', status: 'stable', summary: 'Bordered panel surface for grouped content.', library: { name: 'stack-alabaster', extends: null, default: false } },
    { id: 'components/stack-alabaster/tabs', usage: 'copy', status: 'stable', summary: 'Tab strip with keyboard roving.', library: { name: 'stack-alabaster', extends: null, default: false } },
    { id: 'components/dithercn/dither-image', usage: 'copy', status: 'experimental', summary: 'Image rendered through an ordered dither.', library: { name: 'dithercn', extends: null, default: false } },
    { id: 'libraries/solid-js', usage: 'package', status: 'stable', summary: 'Pinned SolidJS reference for app renderers.' },
    { id: 'assets/escacs-mark', usage: 'copy', status: 'stable', summary: 'The Escacs knight logo mark as SVG.' },
    { id: 'templates/agents-md', usage: 'copy', status: 'stable', summary: 'AGENTS.md scaffold for a new project.', payload: 'files' },
    { id: 'workers/mel', usage: 'reference', status: 'experimental', summary: 'How to work with Mel: semi-technical client who judges visible results.' },
    { id: 'workers/yuno', usage: 'reference', status: 'experimental', summary: 'How to work with Yuno: technical owner who expects autonomous agent work.' },
    // Not in the stack's HEAD commit: unimportable, carries the
    // not-committed marker everywhere it is listed.
    { id: 'skills/draft-entry', usage: 'link', status: 'experimental', summary: 'An entry drafted in the worktree but not committed yet.', committed: false },
  ];

  const KIND_OF = { skills: 'skill', styles: 'style', systems: 'system', components: 'component', libraries: 'library', assets: 'asset', templates: 'template', workers: 'worker' };

  const listLine = (e) =>
    `- ${e.id} [${e.usage}${e.status === 'stable' ? '' : `, ${e.status}`}]: ${e.summary}`;

  const entryName = (e) => e.id.split('/').pop();
  const entryKind = (e) => KIND_OF[e.id.split('/')[0]];

  const entryManifest = (e) => {
    const m = {
      $schema: '../../schema/stack.schema.json',
      name: entryName(e),
      kind: entryKind(e),
      summary: e.summary,
      status: e.status,
      origin: 'custom',
      tags: [entryName(e), 'fixture'],
      targets: ['any'],
    };
    if (e.requires) m.requires = e.requires;
    if (e.payload) m.payload = e.payload;
    return m;
  };

  const entryFiles = (e) => {
    const base = e.payload
      ? ['README.md', 'stack.json', `${e.payload}/AGENTS.md`, `${e.payload}/config.json`]
      : ['README.md', 'stack.json'];
    // Skills and styles carry SKILL.md as their entry doc (the real layout).
    if (/^(skills|styles)\//.test(e.id)) base.unshift('SKILL.md');
    // One image-bearing entry so previews and file bodies render.
    if (e.id === 'assets/escacs-mark') base.push('escacs-logo.svg');
    // Scenario-specific extras (review-changes fixtures): files the entry gained upstream.
    for (const x of fx.extraFiles?.[e.id] ?? []) if (!base.includes(x)) base.push(x);
    return base;
  };

  const entryFileBody = (e, path) => {
    const fixture = fx.bodies?.[`${e.id}|${path}`]?.upstream;
    if (fixture != null) return { binary: false, markdown: path.endsWith('.md'), text: fixture, base64: null };
    if (path.endsWith('.svg')) {
      return {
        binary: false,
        markdown: false,
        text: null,
        // Tiny mint-on-black "S" tile (precomputed; the mock runs in a browser).
        base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMGEwYTBhIi8+PHRleHQgeD0iOCIgeT0iNDAiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiM3Q0ZGQjIiPlM8L3RleHQ+PC9zdmc+',
      };
    }
    if (path === 'stack.json') {
      return { binary: false, markdown: false, text: JSON.stringify(entryManifest(e), null, 2), base64: null };
    }
    if (path === entryDocName(e)) {
      return { binary: false, markdown: true, text: entryDocBody(e), base64: null };
    }
    if (path.endsWith('.md')) return { binary: false, markdown: true, text: `# Fixture ${path}\n`, base64: null };
    if (path.endsWith('.png')) return { binary: true, markdown: false, text: null, base64: null };
    return { binary: false, markdown: false, text: `fixture contents of ${path}\n`, base64: null };
  };

  const entryDocName = (e) => (e.id.startsWith('skills/') || e.id.startsWith('styles/') ? 'SKILL.md' : 'README.md');

  const entryDocBody = (e) => [
    `# Fixture ${entryName(e)}`,
    '',
    'Invented fixture documentation. The real entry doc would render here.',
    '',
    '## Notes',
    '',
    'A second `## ` heading on purpose: doc bodies keep everything after the doc start.',
  ].join('\n');

  const entryJson = (e) => {
    const files = entryFiles(e);
    return {
      id: e.id,
      kind: entryKind(e),
      name: entryName(e),
      summary: e.summary,
      status: e.status,
      origin: 'custom',
      usage: e.usage,
      doc: `${e.id}/${entryDocName(e)}`,
      tags: [entryName(e), 'fixture'],
      targets: ['any'],
      ...(e.requires ? { requires: e.requires } : {}),
      ...(e.payload ? { payload: e.payload } : {}),
      ...(e.library ? { library: e.library } : {}),
      committed: e.committed !== false,
      files: files.length,
      bytes: files.reduce((n, p) => n + 100 + p.length, 0),
      preview: files.find((p) => /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(p)) ?? null,
    };
  };

  const showJson = (e) => ({
    command: 'show',
    id: e.id,
    committed: e.committed !== false,
    usage: e.usage,
    manifest: entryManifest(e),
    ...(e.library ? { library: e.library } : {}),
    files: entryFiles(e).map((p) => ({ path: p, size: 100 + p.length })),
    doc: entryDocBody(e),
  });

  const showText = (e) => [
    `# ${e.id}`,
    '',
    `Absolute path: /home/dev/escacs/stack/${e.id}`,
    `Usage: ${e.usage} — fixture help text.`,
    '',
    '## Manifest',
    '```json',
    JSON.stringify(entryManifest(e), null, 2),
    '```',
    '',
    '## Files',
    ...entryFiles(e).map((f) => `- ${f}`),
    '',
    `## ${entryDocName(e)}`,
    '',
    entryDocBody(e),
  ].join('\n');

  // ------------------------------------------------------------------ lock
  // Rendered into the exact shapes of imports.mjs (statusEntries for --json,
  // formatStatus() for text).

  // Same priority as the CLI: gone > missing > update-available > edited > up-to-date.
  const rowStateWord = (r) => {
    const missing = r.missing ?? [];
    if (r.gone) return 'gone';
    if (missing.length) return 'missing';
    if (r.upstream?.length) return 'update-available';
    if ((r.local ?? []).some((f) => !missing.includes(f))) return 'edited';
    return 'up-to-date';
  };
  const statusJson = (rows) => ({
    command: 'status',
    commit: FULL,
    rows: rows.map((r) => ({
      id: r.id, path: r.path, commit: r.commit,
      local: [...(r.local ?? [])], upstream: [...(r.upstream ?? [])], gone: !!r.gone,
      missing: [...(r.missing ?? [])], state: rowStateWord(r),
    })),
  });

  const statusText = (rows) => {
    if (!rows.length) return 'No stack imports here (no stack.toml).';
    const lines = [`stack at ${HEAD}`];
    for (const r of rows) {
      const bits = [];
      if (r.gone) bits.push('removed from stack');
      else if (r.upstream?.length) bits.push(`update: ${r.upstream.length} file${r.upstream.length > 1 ? 's' : ''}`);
      if (r.local?.length) bits.push(`edited here: ${r.local.join(', ')}`);
      lines.push(`${bits.length ? '*' : ' '} ${r.id} @${r.commit.slice(0, 7)} -> ${r.path}${bits.length ? `  (${bits.join('; ')})` : ''}`);
    }
    return lines.join('\n');
  };

  const destFor = (id) => {
    if (id.startsWith('skills/') || id.startsWith('styles/')) return `.agents/skills/${id.split('/').pop()}`;
    const e = CATALOG.find((x) => x.id === id);
    if (e?.payload) return '.';
    return `.stack/${id}`;
  };

  // `--to` validation, mirroring the Rust join_inside (paths.rs): absolute
  // paths and lexical `..` escapes are rejected with the same messages, so
  // mock runs don't hide real errors. The symlink check needs a filesystem,
  // so the mock skips it.
  const checkTo = (to) => {
    if (to == null) return null;
    if (!to || to.length > 512) return 'invalid path';
    if (to.startsWith('/') || /^[A-Za-z]:[\\/]/.test(to)) {
      return 'use a project-relative path, not an absolute one';
    }
    let depth = 0;
    for (const seg of to.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        depth--;
        if (depth < 0) return 'path escapes the project directory';
      } else depth++;
    }
    return null;
  };

  // The look-alike files an import aimed at `dest` would collide with: a
  // `--to` elsewhere sidesteps them, a `--to` on top of them refuses, exactly
  // like the real import plan.
  const clashUnder = (id, dest) =>
    (fx.lookalikeFor?.[id] ?? []).filter((f) => dest === '.' || f === dest || f.startsWith(`${dest}/`));

  // ---------------------------------------------------------- preset fixtures
  // Rendered into the exact JSON shapes of `preset list/show/apply --json`.

  const PRESETS = [
    {
      name: 'web',
      description: 'React starter: button plus the file-pr skill.',
      source: 'presets/web.json',
      imports: [
        { id: 'components/react/button', to: 'src/components/ui' },
        { id: 'skills/file-pr', to: null },
      ],
    },
    {
      name: 'docs',
      description: 'Docs setup: conventions plus the agents-md scaffold.',
      source: 'presets/docs.json',
      imports: [
        { id: 'systems/engineering-conventions', to: null },
        { id: 'templates/agents-md', to: null },
      ],
    },
  ];

  // A bigger list for the many/manyfresh/lots scenarios: the first two are
  // the real fixtures above, the rest combine catalog entries (names and
  // descriptions invented, a few long enough to truncate).
  const makePresets = (n) => {
    const ids = CATALOG.filter((e) => e.committed !== false && !e.id.startsWith('workers/')).map((e) => e.id);
    const more = [
      ['api', 'Server starter: conventions, the file-pr skill and an AGENTS.md scaffold.'],
      ['cli', 'Command line tool: conventions plus the ponytail skill for small changes.'],
      ['desktop', 'Tauri + Solid desktop app: solid-js reference, button and the escacs mark, with the folio-light style on top.'],
      ['mobile', 'Mobile web shell: button, icon button and the logo mark.'],
      ['landing', 'Marketing page: folio-light style, the mark and a button.'],
      ['lib', 'Library repo: conventions and agents-md.'],
      ['monorepo', 'Workspace root: AGENTS.md, conventions and the review skills for every package.'],
      ['review', 'Review setup: file-pr and ponytail.'],
      ['design', 'Design handoff: folio-light, the mark and the button set.'],
      ['agents', 'Agent scaffold: agents-md plus conventions.'],
      ['data', 'Data project: conventions only.'],
      ['game', 'Game jam: ponytail, the mark and a button.'],
      ['oss', 'Open source repo: conventions, agents-md and file-pr, so contributors land on the same rules.'],
      ['site', 'Static site: folio-light and the mark.'],
      ['pr-only', 'Just the pull request skill.'],
      ['icons', 'Icon set: icon-button and the mark.'],
      ['tiny', 'The smallest useful setup.'],
      ['solid', 'SolidJS app: solid-js reference and the button.'],
      ['react-ui', 'React UI kit: button and icon button.'],
      ['writing', 'Writing project: folio-light and conventions.'],
      ['plugin', 'Plugin repo: AGENTS.md and the ponytail skill.'],
      ['infra', 'Infra repo: conventions, no UI.'],
      ['playground', 'Throwaway sandbox with every skill.'],
      ['brand', 'Brand kit: mark, folio-light, button.'],
      ['audit', 'Audit trail: conventions and file-pr.'],
      ['docs-site', 'Docs site: folio-light, conventions and agents-md.'],
      ['extension', 'Browser extension: button, icon button, mark.'],
      ['bot', 'Chat bot: conventions, ponytail and agents-md.'],
      ['kiosk', 'Kiosk app: solid-js reference, button, mark and the folio-light style for a clean full screen layout.'],
      ['handoff', 'Hand a repo to a new owner: conventions and agents-md.'],
      ['starter-kit', 'Everything small: file-pr, ponytail and the mark.'],
      ['studio', 'Design studio repo: style, mark and button.'],
    ];
    const pick = (i, k) => Array.from({ length: k }, (_, j) => ids[(i * 3 + j * 2) % ids.length]);
    const out = [...PRESETS];
    for (let i = 0; out.length < n && i < more.length; i++) {
      const [name, description] = more[i];
      out.push({
        name, description, source: `presets/${name}.json`,
        imports: [...new Set(pick(i + 1, 1 + (i % 3)))].map((id) => ({ id, to: null })),
      });
    }
    return out;
  };

  // ------------------------------------------------------------- scenarios

  const baseConfig = {
    recentProjects: [],
    stackPath: '/home/dev/escacs/stack',
    scanRoot: null,
    scanRoots: [],
    worker: 'mel',
    project: null,
    notice: null,
  };

  const cleanLock = () => ([
    { id: 'skills/file-pr', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/file-pr', local: [], upstream: [] },
    { id: 'styles/folio-light', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/folio-light', local: [], upstream: [] },
    { id: 'workers/mel', commit: `${HEAD}00000000000000000000000000000000000`, path: '.stack/workers/mel', local: [], upstream: [] },
  ]);

  const okStack = {
    path: '/home/dev/escacs/stack',
    valid: true,
    source: 'settings',
    git: true,
    cli: true,
    node: { ok: true, version: 'v22.14.0', major: 22, error: null },
    error: null,
  };


  // Review-changes fixtures (the `conflicts` scenario). skills/file-pr: SKILL.md was
  // edited here AND changed upstream (both sides), helpers.mjs is new upstream only.
  // templates/agents-md: AGENTS.md changed upstream only.
  const lines = (n, p) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`);
  const FILE_PR_UPSTREAM = ['---', 'name: file-pr', 'description: File a concise pull request from the current branch.', '---', '', '# file-pr', '', ...lines(14, 'Step'), '', '## Output', '', 'Open the PR with a title under 70 characters and a three-bullet body.', 'Link the issue it closes.', 'Mention any follow-up work in a final line.', '', ...lines(10, 'Note'), '', 'Never push to the default branch.'].join('\n') + '\n';
  const FILE_PR_INSTALLED = ['---', 'name: file-pr', 'description: File a concise pull request from the current branch.', '---', '', '# file-pr', '', ...lines(14, 'Step'), '', '## Output', '', 'Open the PR with a short title and a two-bullet body (my house style).', 'Link the issue it closes.', '', ...lines(10, 'Note'), '', 'Never push to the default branch.', 'Always ask me before pushing.'].join('\n') + '\n';
  const HELPERS_UPSTREAM = ['export function title(branch) {', "  return branch.replace(/[-_]/g, ' ');", '}', '', 'export function body(commits) {', "  return commits.slice(0, 3).map((c) => `- ${c}`).join('\\n');", '}'].join('\n') + '\n';
  const AGENTS_OLD = ['# AGENTS.md', '', '## Conventions', '', 'Keep changes small.', 'Run the tests before you finish.'].join('\n') + '\n';
  const AGENTS_NEW = ['# AGENTS.md', '', '## Conventions', '', 'Keep changes small.', 'Run the tests before you finish.', '', '## Reviews', '', 'Ask for a review on anything over 200 lines.'].join('\n') + '\n';

  const SCENARIOS = {
    empty: () => ({
      config: { ...baseConfig, worker: null },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: [], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: null,
    }),
    populated: () => ({
      config: {
        ...baseConfig,
        recentProjects: ['/home/dev/projects/folio', '/home/dev/projects/auralis'],
        project: '/home/dev/projects/folio',
      },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({
        path, valid: true,
        markers: ['stack.toml', '.agents/skills', 'package.json', '.git'],
        errors: [],
      }),
      lock: cleanLock(),
      // Marker fixtures: one entry with uncommitted stack changes plus the
      // catalog-wide not-committed draft entry.
      uncommitted: ['styles/folio-light'],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
    }),
    'no-node': () => ({
      config: { ...baseConfig, project: null },
      node: {
        ok: false, version: null, major: null,
        error: 'node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.',
      },
      stack: {
        path: '/home/dev/escacs/stack', valid: false, source: 'settings',
        git: true, cli: true,
        node: { ok: false, version: null, major: null, error: 'node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.' },
        error: 'node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.',
      },
      report: (path) => ({ path, valid: false, markers: [], errors: ['cannot resolve path'] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: null,
    }),
    conflicts: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['stack.toml', '.git'], errors: [] }),
      lock: [
        { id: 'skills/file-pr', commit: 'a1b2c3d000000000000000000000000000000000', path: '.agents/skills/file-pr', local: ['SKILL.md', 'helpers.mjs'], upstream: ['SKILL.md', 'helpers.mjs'] },
        { id: 'styles/folio-light', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/folio-light', local: [], upstream: [] },
        { id: 'templates/agents-md', commit: 'a1b2c3d000000000000000000000000000000000', path: '.', local: [], upstream: ['AGENTS.md'] },
      ],
      extraFiles: { 'skills/file-pr': ['helpers.mjs'] },
      bodies: {
        'skills/file-pr|SKILL.md': { upstream: FILE_PR_UPSTREAM },
        'skills/file-pr|helpers.mjs': { upstream: HELPERS_UPSTREAM },
        'templates/agents-md|files/AGENTS.md': { upstream: AGENTS_NEW },
      },
      installed: {
        '.agents/skills/file-pr/SKILL.md': FILE_PR_INSTALLED,
        '.agents/skills/file-pr/helpers.mjs': `// my helper tweaks\n${HELPERS_UPSTREAM}`,
        'AGENTS.md': AGENTS_OLD,
      },
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
    }),
    missing: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['stack.toml'], errors: [] }),
      lock: [
        { id: 'skills/ponytail', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/ponytail', local: ['SKILL.md'], upstream: [], missing: ['SKILL.md'] },
        { id: 'assets/escacs-mark', commit: `${HEAD}00000000000000000000000000000000000`, path: '.stack/assets/escacs-mark', local: ['logo.svg'], upstream: [], missing: ['logo.svg'] },
      ],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
    }),
    lookalike: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['.agents/skills', '.git'], errors: [] }),
      // skills/file-pr exists on disk but was never imported: the import
      // below fails exactly like the real CLI refusal.
      lock: [
        { id: 'workers/yuno', commit: `${HEAD}00000000000000000000000000000000000`, path: '.stack/workers/yuno', local: [], upstream: [] },
      ],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
      lookalikeFor: {
        'skills/file-pr': ['.agents/skills/file-pr/SKILL.md', '.agents/skills/file-pr/helpers.mjs'],
      },
    }),
    // Adopt suggestions: folders that look like entries but were never
    // imported. adopt0 has only a non-matching folder (nothing to adopt),
    // adopt1 one identical folder, adopt3 three — ponytail with differing
    // files, for the refusal. adopt1 and adopt3 have no stack.toml, so the
    // init button sits next to the suggestions.
    adopt0: () => ({ ...SCENARIOS.populated(), folders: ['.agents/skills/my-own-thing'] }),
    adopt1: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['.agents/skills', '.git'], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
      folders: ['.agents/skills/ponytail'],
      fresh: true,
    }),
    adopt3: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['.agents/skills', '.git'], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
      folders: [
        '.agents/skills/file-pr',
        '.agents/skills/ponytail',
        '.stack/systems/engineering-conventions',
      ],
      lookalikeFor: {
        'skills/ponytail': ['.agents/skills/ponytail/SKILL.md'],
      },
      fresh: true,
    }),
    scan: () => ({
      config: {
        ...baseConfig,
        recentProjects: ['/home/dev/projects/folio'],
        scanRoot: '/home/dev/projects',
        project: null,
      },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: [], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [
        { path: '/home/dev/projects/folio', name: 'folio', hasLock: true, markers: ['.git', 'stack.toml', '.agents/skills', '.gitignore'] },
        { path: '/home/dev/projects/auralis', name: 'auralis', hasLock: false, markers: ['.git', '.gitignore'] },
        { path: '/home/dev/projects/sandbox', name: 'sandbox', hasLock: false, markers: [] },
      ],
      pick: '/home/dev/projects/auralis',
    }),
    noworker: () => ({
      config: { ...baseConfig, worker: null, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['stack.toml'], errors: [] }),
      lock: [
        { id: 'skills/file-pr', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/file-pr', local: [], upstream: [] },
      ],
      uncommitted: [],
      noWorkers: true,
      scan: [],
      pick: '/home/dev/projects/folio',
    }),
    // Onboarding step 2: worker set, no project yet. Recents plus scan
    // results, so the project screen shows every block.
    noproject: () => ({
      config: {
        ...baseConfig,
        recentProjects: ['/home/dev/projects/folio', '/home/dev/projects/sandbox'],
      },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['.git'], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [
        { path: '/home/dev/projects/folio', name: 'folio', hasLock: true, markers: ['.git', 'stack.toml'] },
        { path: '/home/dev/projects/auralis', name: 'auralis', hasLock: false, markers: ['.git'] },
      ],
      pick: '/home/dev/projects/auralis',
    }),
    // Plain folder, no record file of either generation: status must offer
    // init. Running init flips the markers to stack.toml.
    fresh: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/sandbox'], project: '/home/dev/projects/sandbox' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({ path, valid: true, markers: ['.git', 'package.json'], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [
        { path: '/home/dev/projects/sandbox', name: 'sandbox', hasLock: false, markers: ['.git', 'package.json'] },
      ],
      pick: '/home/dev/projects/sandbox',
      fresh: true,
    }),
    // Many presets: the presets section must scale. `many` has three
    // imports (the section starts collapsed), `manyfresh` has none (set-up
    // slot, section open), `lots` has 33 presets and three imports.
    many: () => ({ ...SCENARIOS.populated(), presets: makePresets(15) }),
    manyfresh: () => ({ ...SCENARIOS.fresh(), presets: makePresets(15) }),
    lots: () => ({ ...SCENARIOS.populated(), presets: makePresets(40) }),
    // Inline row imports: all four row states in one catalog.
    // skills/file-pr is already imported (the `(imported)` row);
    // skills/ponytail imports plain with the default destination;
    // components/react/button needs a --to and pulls icon-button (+1 dep);
    // styles/folio-light refuses with look-alikes unless given a --to.
    quickimport: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({
        path, valid: true,
        markers: ['stack.toml', '.agents/skills', '.git'],
        errors: [],
      }),
      lock: [
        { id: 'skills/file-pr', commit: FULL, path: '.agents/skills/file-pr', local: [], upstream: [] },
      ],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
      lookalikeFor: {
        'styles/folio-light': ['.agents/skills/folio-light/SKILL.md', '.agents/skills/folio-light/theme.json'],
      },
    }),
    // Batch import: the components kind holds ten entries (react plus an
    // eight-member batch library). batch/avatar and skills/file-pr are
    // already imported; styles/folio-light refuses at its default
    // destination and batch/card refuses under the conventional
    // src/components base (any other base imports it fine).
    batchimport: () => ({
      config: { ...baseConfig, recentProjects: ['/home/dev/projects/folio'], project: '/home/dev/projects/folio' },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: structuredClone(okStack),
      report: (path) => ({
        path, valid: true,
        markers: ['stack.toml', '.agents/skills', '.git'],
        errors: [],
      }),
      lock: [
        { id: 'skills/file-pr', commit: FULL, path: '.agents/skills/file-pr', local: [], upstream: [] },
        { id: 'components/batch/avatar', commit: FULL, path: 'src/components/avatar', local: [], upstream: [] },
      ],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: '/home/dev/projects/folio',
      extraCatalog: ['card', 'dialog', 'input', 'select', 'tabs', 'tooltip', 'avatar', 'badge'].map((n) => ({
        id: `components/batch/${n}`,
        usage: 'copy',
        status: 'experimental',
        summary: `Batch library ${n} component (fixture).`,
        library: { name: 'batch', extends: null, default: false },
      })),
      lookalikeFor: {
        'styles/folio-light': ['.agents/skills/folio-light/SKILL.md', '.agents/skills/folio-light/theme.json'],
        'components/batch/card': ['src/components/card/README.md', 'src/components/card/stack.json'],
      },
    }),
    // Components as a file explorer: six libraries. react and stack-alabaster
    // are plain; stack-alabaster is fully imported (Imported ✓); drafts has
    // only uncommitted members (Import all disabled); dithercn is a remote
    // library whose members the plan cannot resolve; batch has eight members
    // with avatar already imported.
    explorer: () => {
      const base = SCENARIOS.populated();
      const row = (id, path) => ({ id, commit: FULL, path, local: [], upstream: [] });
      return {
        ...base,
        lock: [...base.lock, row('components/stack-alabaster/panel', 'src/components/panel'), row('components/stack-alabaster/tabs', 'src/components/tabs'), row('components/batch/avatar', 'src/components/avatar')],
        remoteFail: { 'components/dithercn/': 'remote: dithercn is a remote component library and its cache is not ready (members are fetched live)' },
        extraCatalog: [
          { id: 'components/dithercn/dither-button', usage: 'copy', status: 'experimental', summary: 'Button with a dithered fill.', library: { name: 'dithercn', extends: null, default: false } },
          { id: 'components/drafts/sheet', usage: 'copy', status: 'experimental', summary: 'Bottom sheet, not committed yet.', committed: false, library: { name: 'drafts', extends: 'react', default: false } },
          { id: 'components/drafts/menu', usage: 'copy', status: 'experimental', summary: 'Menu, not committed yet.', committed: false, library: { name: 'drafts', extends: 'react', default: false } },
          ...['card', 'dialog', 'input', 'select', 'tabs', 'tooltip', 'avatar', 'badge'].map((n) => ({
            id: `components/batch/${n}`, usage: 'copy', status: 'experimental', summary: `Batch library ${n} component (fixture).`, library: { name: 'batch', extends: null, default: false },
          })),
        ],
      };
    },
    // First-run gate: nothing validates, the app must show StackSetup.
    // get stack clones and the gate lifts (see the provision_stack handler).
    'bad-stack': () => ({
      config: { ...baseConfig, stackPath: null, worker: null, project: null },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: {
        path: '', valid: false, source: 'missing',
        git: false, cli: false,
        node: { ok: true, version: 'v22.14.0', major: 22, error: null },
        error: 'no escacs/stack checkout found: looked upward from the app, its install folder and the working folder for tools/stack/cli.mjs. Press get stack, or pick your stack clone (the folder containing tools/stack/cli.mjs), or set ESCACS_STACK.',
      },
      report: (path) => ({ path, valid: true, markers: [], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: null,
      provision: { status: 'cloned-gh', path: '/home/dev/escacs/stack', message: 'cloned with gh to ~/escacs/stack' },
      cli: { status: 'missing', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: null, onPath: true, message: '~/.local/bin/stack is not linked yet.' },
    }),
    // First-run gate with no auth: get stack fails with the one actionable
    // error and the gate stays.
    'no-auth': () => {
      const f = SCENARIOS['bad-stack']();
      f.provision = { status: 'manual', path: null, message: 'could not fetch the stack: escacs/stack is private and no GitHub auth was found. run gh auth login, then retry.' };
      return f;
    },
    // Valid stack, command not linked: boot shows the quiet [add stack
    // command] line.
    'no-cli': () => {
      const f = SCENARIOS.populated();
      f.cli = { status: 'missing', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: null, onPath: true, message: '~/.local/bin/stack is not linked yet.' };
      return f;
    },
    // Valid stack, something else owns the name: the quiet line explains,
    // with no offer (linking refuses to replace it).
    'cli-foreign': () => {
      const f = SCENARIOS.populated();
      f.cli = { status: 'foreign-file', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: null, onPath: true, message: '~/.local/bin/stack exists and is not a symlink; leaving it alone.' };
      return f;
    },
    // Valid stack, the link points at another stack's shim: the quiet
    // line explains, with no offer (linking refuses to repoint it).
    'cli-elsewhere': () => {
      const f = SCENARIOS.populated();
      f.cli = { status: 'points-elsewhere', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: '~/other-stack/bin/stack', onPath: true, message: '~/.local/bin/stack points at ~/other-stack/bin/stack, not at the stack shim; leaving it alone.' };
      return f;
    },
    // Valid stack, linked, but the bin dir is off PATH: the quiet line
    // carries the export hint, with no offer (nothing left to link).
    'no-path': () => {
      const f = SCENARIOS.populated();
      f.cli = { status: 'bin-not-on-PATH', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: '~/escacs/stack/bin/stack', onPath: false, message: '~/.local/bin/stack is linked, but ~/.local/bin is not on PATH; add: export PATH="$HOME/.local/bin:$PATH", then open a new shell.' };
      return f;
    },
  };

  // Failure-mode fixtures on top of the populated project:
  //  offline     the catalog list answers once, then the network drops (1.5 s)
  //              so Browse keeps its saved list and a refresh fails
  //  dirty       a real import is refused: uncommitted changes in the project
  //  locked      a real import is refused: git is busy (index.lock)
  //  interrupted a real import stops halfway: one file landed, one did not
  SCENARIOS.offline = () => ({ ...SCENARIOS.populated(), offlineAfter: 1500 });
  SCENARIOS.dirty = () => ({ ...SCENARIOS.populated(), importFail: "error: Your local changes to the following files would be overwritten by merge:\n\t.agents/skills\nPlease commit your changes or stash them before you merge." });
  SCENARIOS.locked = () => ({ ...SCENARIOS.populated(), importFail: "fatal: Unable to create '/home/dev/projects/folio/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository." });
  SCENARIOS.interrupted = () => ({ ...SCENARIOS.populated(), interrupted: true });

  const fx = (SCENARIOS[scenario] ?? SCENARIOS.populated)();
  let listFailMsg = 'fixture: the stack moved mid-browse (mock +listfail)';
  if (fx.offlineAfter) {
    setTimeout(() => {
      listsFail = true;
      listFailMsg = "fatal: unable to access 'https://github.com/escacs/stack.git/': Could not resolve host: github.com";
    }, fx.offlineAfter);
  }
  // `+persist` makes the config survive reloads like the real config.json
  // does (worker, project, recents), for relaunch checks. Clear it with
  // localStorage.removeItem('stack:mock-config:<scenario>').
  const persistKey = `stack:mock-config:${scenario}`;
  const persistOn = flags.includes('persist');
  if (persistOn) {
    try {
      const saved = JSON.parse(localStorage.getItem(persistKey) || 'null');
      if (saved) Object.assign(fx.config, saved);
    } catch {
      /* ignore */
    }
  }
  const persistConfig = () => {
    if (!persistOn) return;
    try {
      const { worker, project, recentProjects } = fx.config;
      localStorage.setItem(persistKey, JSON.stringify({ worker, project, recentProjects }));
    } catch {
      /* ignore */
    }
  };
  const presets = () => fx.presets ?? PRESETS;
  // Provision + stack-command fixtures default to the settled state (a kept
  // checkout, the command linked); scenarios above override what they need.
  fx.provision ??= { status: 'kept', path: '/home/dev/escacs/stack', message: 'already at ~/escacs/stack' };
  fx.cli ??= { status: 'linked-ok', link: '~/.local/bin/stack', expected: '~/escacs/stack/bin/stack', actual: '~/escacs/stack/bin/stack', onPath: true, message: 'the stack command is linked.' };
  const okOut = (stdout) => ({ stdout, stderr: '', code: 0, truncated: false });
  const errOut = (stderr, code = 1) => ({ stdout: '', stderr, code, truncated: false });
  const jsonOut = (v) => okOut(JSON.stringify(v, null, 2));

  // ------------------------------------------------------- stack_run router
  // Emulates the shell: parse --json/--/--kind/--to like build_argv, then
  // answer in the real CLI shapes (JSON when asked, text otherwise).

  function splitArgs(args) {
    const out = { json: false, dryRun: false, kind: null, to: null, file: null, noBackup: false, choices: {}, positional: [] };
    let dashdash = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (dashdash) { out.positional.push(a); continue; }
      if (a === '--') { dashdash = true; continue; }
      if (a === '--json') { out.json = true; continue; }
      if (a === '--dry-run') { out.dryRun = true; continue; }
      if (a === '--offline') continue; // read-only network skip, no effect on fixtures
      if (a === '--kind') { out.kind = args[++i]; continue; }
      if (a === '--to') { out.to = args[++i]; continue; }
      if (a === '--file') { out.file = args[++i]; continue; }
      if (a === '--no-backup') { out.noBackup = true; continue; }
      // Per-file update choices (repeat the flag or use commas, like the CLI).
      if (a === '--keep-mine' || a === '--take-upstream') {
        for (const f of String(args[++i] ?? '').split(',').filter(Boolean)) out.choices[f] = a === '--keep-mine' ? 'mine' : 'upstream';
        continue;
      }
      if (a === '--resolve') {
        const [f, w] = String(args[++i] ?? '').split('=');
        if (f && (w === 'mine' || w === 'upstream')) out.choices[f] = w;
        continue;
      }
      out.positional.push(a);
    }
    return out;
  }

  const kindMatch = (e, kind) =>
    !kind || e.id.split('/')[0] === `${kind}s` || (kind === 'component' && e.id.startsWith('components/'));

  function stack({ subcommand: sub, args = [] }) {
    if (!fx.node.ok) return errOut('node 22+ is required (fixture: no-node scenario)');
    const { json, dryRun, kind, to, file, noBackup, choices, positional } = splitArgs(args);
    // Same gate as the Rust argv builder: import, update, restore, sync and
    // preset apply take --dry-run (list/show reject it below).
    if (dryRun && !['import', 'preset', 'update', 'restore', 'sync'].includes(sub)) {
      return errOut('--dry-run is only supported by import, update, restore, sync and preset apply');
    }
    if ((Object.keys(choices).length || noBackup) && sub !== 'update') {
      return errOut('--keep-mine/--take-upstream/--resolve/--no-backup are only for update');
    }
    // Bare catalog lists only: boot's `list worker` answers even while
    // the refresh fixture fails the catalog.
    if (sub === 'list' && !positional[0] && listsFail) {
      return errOut(listFailMsg);
    }
    const catalog = [...CATALOG, ...(fx.extraCatalog ?? [])];
    const visible = [...catalog.filter((e) => !(fx.noWorkers && e.id.startsWith('workers/'))), ...extra];
    // The pick-multi fixture needs two same-named entries; the default
    // catalog keeps unique names, so the twin only exists under the flag.
    if (pickFlag === 'multi') {
      visible.push({ id: 'components/legacy/button', usage: 'copy', status: 'experimental', summary: 'Legacy button that shares its name with the react one.', library: { name: 'legacy', extends: null, default: false } });
    }
    switch (sub) {
      case 'list': {
        const rows = visible.filter((e) => kindMatch(e, positional[0]));
        if (!json) return okOut(rows.length ? rows.map(listLine).join('\n') : 'No matching entries.');
        return jsonOut({
          command: 'list', kind: positional[0] ?? null, count: rows.length,
          entries: rows.map(entryJson), uncommitted: [...fx.uncommitted],
        });
      }
      case 'search': {
        const q = (positional[0] ?? '').toLowerCase();
        const rows = visible.filter((e) => {
          if (!kindMatch(e, kind)) return false;
          return !q || `${e.id} ${e.summary}`.toLowerCase().includes(q);
        });
        if (!json) return okOut(rows.length ? rows.map(listLine).join('\n') : 'No matching entries.');
        return jsonOut({
          command: 'search', query: positional[0] ?? '', kind, count: rows.length,
          entries: rows.map(entryJson), uncommitted: [...fx.uncommitted],
        });
      }
      case 'show': {
        const e = visible.find((x) => x.id === positional[0]);
        if (!e) {
          return errOut(`no entry "${positional[0]}"; search first, or list with \`stack list\``);
        }
        if (file != null) {
          const known = entryFiles(e);
          if (!known.includes(file)) return errOut(`no such file '${file}' in ${e.id}`);
          const body = entryFileBody(e, file);
          if (!json) {
            if (body.text == null) return errOut(`binary file '${file}'; use --json for base64`);
            return okOut(body.text);
          }
          return jsonOut({
            command: 'show', id: e.id, file, size: 100 + file.length,
            binary: body.binary, markdown: body.markdown, text: body.text, base64: body.base64,
          });
        }
        return json ? jsonOut(showJson(e)) : okOut(showText(e));
      }
      case 'status': {
        return json ? jsonOut(statusJson(fx.lock)) : okOut(statusText(fx.lock));
      }
      case 'init': {
        if (fx.lock.length) return errOut('stack.toml already tracks imports; nothing to do');
        if (fx.fresh) {
          fx.report = (path) => ({ path, valid: true, markers: ['stack.toml', '.git', 'package.json'], errors: [] });
          fx.fresh = false;
        }
        const body = { command: 'init', migrated: false, entries: 0, gitignore: 'updated' };
        return json ? jsonOut(body) : okOut('created stack.toml\nignore  updated .gitignore (managed escacs block)');
      }
      case 'import': {
        const ids = positional;
        if (to && ids.length > 1) return errOut('--to works with one id at a time');
        const badTo = checkTo(to);
        if (badTo) return errOut(badTo);
        const log = [];
        const imported = [];
        const already = [];
        // A dry run plans without writing: look-alike collisions are
        // reported in `conflicts`, not thrown. The project page uses it to
        // learn whether an adoptable folder is identical or differs.
        if (dryRun) {
          const conflicts = [];
          for (const id of ids) {
            const rf = Object.keys(fx.remoteFail ?? {}).find((pre) => id.startsWith(pre));
            if (rf) return errOut(fx.remoteFail[rf]);
            const e = visible.find((x) => x.id === id);
            if (!e || e.committed === false) {
              return errOut(`${id} is not an entry at stack commit ${HEAD} (new entries must be committed to the stack before importing)`);
            }
            // An id the plan already pulled in as a dep counts as already
            // here, like the real import (which sees it in the lock by then).
            if (fx.lock.some((r) => r.id === id) || imported.some((p) => p.id === id)) {
              already.push(id);
              continue;
            }
            const clash = clashUnder(id, to || destFor(id));
            if (clash.length) conflicts.push(...clash);
            imported.push({ id, path: to || destFor(id) });
            // Same auto-import of requires as the real import below. A dry
            // run writes nothing, so dedupe against the plan as well as the
            // lock (the real path dedupes through the lock it updates).
            for (const req of e.requires ?? []) {
              if (!fx.lock.some((r) => r.id === req) && !imported.some((p) => p.id === req)) {
                imported.push({ id: req, path: destFor(req), requiredBy: id });
              }
            }
          }
          if (!json) {
            return okOut([
              ...imported.map((p) => `import  ${p.id} -> ${p.path}${p.requiredBy ? ` (required by ${p.requiredBy})` : ''}`),
              ...conflicts.map((c) => `CONFLICT ${c} (exists with other content; a real import would abort)`),
              'dry run: nothing written',
            ].join('\n'));
          }
          return jsonOut({ command: 'import', dryRun: true, commit: FULL, imported, already, conflicts, gitignore: 'unchanged' });
        }
        if (fx.importFail) return errOut(fx.importFail);
        if (fx.interrupted && ids.length) {
          const id = ids[0];
          const dest = to || destFor(id);
          // One file landed, one did not: the lock row exists and the status shows the gap.
          fx.lock.push({ id, commit: FULL, path: dest, local: ['SKILL.md', 'notes.md'], upstream: [], missing: ['notes.md'] });
          return errOut(`import was interrupted before it finished\nwrote:\n  ${dest}/SKILL.md\nnot written:\n  ${dest}/notes.md`);
        }
        for (const id of ids) {
          const e = visible.find((x) => x.id === id);
          if (!e || e.committed === false) {
            return errOut(`${id} is not an entry at stack commit ${HEAD} (new entries must be committed to the stack before importing)`);
          }
          if (fx.lock.some((r) => r.id === id)) {
            log.push(`have    ${id} (use \`stack update\` for newer versions)`);
            already.push(id);
            continue;
          }
          const clash = clashUnder(id, to || destFor(id));
          if (clash.length) {
            return errOut(`these files already exist with other content; move them or choose --to:\n  ${clash.join('\n  ')}`);
          }
          const dest = to || destFor(id);
          fx.lock.push({ id, commit: FULL, path: dest, local: [], upstream: [] });
          log.push(`import  ${id} -> ${dest}`);
          imported.push({ id, path: dest });
          for (const req of e.requires ?? []) {
            if (!fx.lock.some((r) => r.id === req)) {
              const rd = destFor(req);
              fx.lock.push({ id: req, commit: FULL, path: rd, local: [], upstream: [] });
              log.push(`import  ${req} -> ${rd} (required by ${id})`);
              imported.push({ id: req, path: rd, requiredBy: id });
            }
          }
        }
        // Like the real CLI, a successful import creates stack.toml
        // implicitly: a fresh fixture gains the marker from here on.
        if (fx.fresh) {
          fx.report = (path) => ({ path, valid: true, markers: ['stack.toml', '.git', 'package.json'], errors: [] });
          fx.fresh = false;
        }
        if (!json) return okOut(log.join('\n'));
        return jsonOut({ command: 'import', commit: FULL, imported, already, gitignore: 'unchanged' });
      }
      case 'preset': {
        const [action, name] = positional;
        // Same gates as the Rust argv builder: no valued flags on any preset
        // action, and --dry-run on apply only.
        if (to != null || kind != null || file != null) {
          return errOut('preset takes no --kind/--to/--ref/--file');
        }
        if (action === 'list') {
          if (dryRun) return errOut('preset list takes no --dry-run');
          const rows = presets().map((p) => ({ name: p.name, description: p.description, imports: p.imports }));
          if (!json) return okOut(rows.length ? rows.map((p) => `- ${p.name}: ${p.description}`).join('\n') : 'No presets.');
          return jsonOut({ command: 'preset', action: 'list', count: rows.length, presets: rows });
        }
        if (action === 'show') {
          if (dryRun) return errOut('preset show takes no --dry-run');
          const p = presets().find((x) => x.name === name);
          if (!p) return errOut(`no preset "${name}"`);
          if (!json) {
            return okOut([
              `# preset ${p.name}`, '', p.description, '',
              ...p.imports.map((i) => `- ${i.id}${i.to ? ` -> ${i.to}` : ''}`),
            ].join('\n'));
          }
          return jsonOut({ command: 'preset', action: 'show', preset: structuredClone(p) });
        }
        if (action === 'apply') {
          const p = presets().find((x) => x.name === name);
          if (!p) return errOut(`no preset "${name}"`);
          // Mirrors the import case: same log lines, same lock updates, same
          // auto-import of requires, same look-alike refusal. A dry run
          // reports conflicts as part of the plan instead of throwing.
          const log = [];
          const imported = [];
          const already = [];
          const conflicts = [];
          // Like the real import plan, a refusal aborts before anything is
          // written: collect every clash up front. A dry run reports them
          // as part of the plan instead of throwing.
          for (const imp of p.imports) {
            if (!fx.lock.some((r) => r.id === imp.id)) {
              conflicts.push(...clashUnder(imp.id, imp.to || destFor(imp.id)));
            }
          }
          if (conflicts.length && !dryRun) {
            return errOut(`these files already exist with other content; move them or choose --to:\n  ${conflicts.join('\n  ')}`);
          }
          for (const imp of p.imports) {
            const e = visible.find((x) => x.id === imp.id);
            if (!e || e.committed === false) {
              return errOut(`${imp.id} is not an entry at stack commit ${HEAD} (new entries must be committed to the stack before importing)`);
            }
            if (fx.lock.some((r) => r.id === imp.id)) {
              log.push(`have    ${imp.id} (use \`stack update\` for newer versions)`);
              already.push(imp.id);
              continue;
            }
            const dest = imp.to || destFor(imp.id);
            if (!dryRun) fx.lock.push({ id: imp.id, commit: FULL, path: dest, local: [], upstream: [] });
            log.push(`import  ${imp.id} -> ${dest}`);
            imported.push({ id: imp.id, path: dest });
            for (const req of e.requires ?? []) {
              if (!fx.lock.some((r) => r.id === req)) {
                const rd = destFor(req);
                if (!dryRun) fx.lock.push({ id: req, commit: FULL, path: rd, local: [], upstream: [] });
                log.push(`import  ${req} -> ${rd} (required by ${imp.id})`);
                imported.push({ id: req, path: rd, requiredBy: imp.id });
              }
            }
          }
          // A real apply creates stack.toml implicitly, like import; a dry
          // run writes nothing.
          if (!dryRun && fx.fresh) {
            fx.report = (path) => ({ path, valid: true, markers: ['stack.toml', '.git', 'package.json'], errors: [] });
            fx.fresh = false;
          }
          if (!json) return okOut(log.join('\n'));
          return jsonOut({
            command: 'preset', action: 'apply', preset: name, commit: FULL,
            imported, already, ...(dryRun ? { dryRun: true, conflicts } : {}), gitignore: 'unchanged',
          });
        }
        return errOut(`unknown preset action "${action}"`);
      }
      case 'update': {
        const rows = fx.lock.filter((r) => !positional.length || positional.includes(r.id));
        if (!rows.length && positional.length) return errOut(`${positional[0]} is not imported here`);
        if (Object.keys(choices).length && positional.length !== 1) return errOut('per-file choices need exactly one entry id');
        const log = [];
        const updated = [];
        const conflicts = [];
        const merged = [];
        const kept = [];
        const skipped = [];
        const gone = [];
        const matched = new Set();
        for (const r of rows) {
          if (r.gone) {
            gone.push(r.id);
            log.push(`gone    ${r.id} was removed from the stack; kept as is (\`stack remove ${r.id}\` to drop it)`);
            continue;
          }
          if (!r.upstream?.length) continue;
          const both = r.upstream.filter((f) => r.local?.includes(f));
          const files = [];
          const stillLocal = new Set(r.local ?? []);
          for (const f of r.upstream) {
            const shown = `${r.path}/${f}`;
            if (!both.includes(f)) { files.push({ path: f, outcome: 'updated' }); merged.push(shown); stillLocal.delete(f); continue; }
            const pick = choices[f];
            if (pick) matched.add(f);
            if (pick === 'mine') { files.push({ path: f, outcome: 'kept-mine' }); kept.push(shown); log.push(`kept    ${shown} (yours)`); }
            else if (pick === 'upstream') {
              files.push({ path: f, outcome: 'took-upstream' }); merged.push(shown); stillLocal.delete(f);
              if (!noBackup) log.push(`saved   ${shown}.mine`);
            } else { files.push({ path: f, outcome: 'conflict-markers' }); conflicts.push(shown); log.push(`CONFLICT ${shown} (1 conflict; resolve the <<<<<<< markers)`); }
          }
          if (!dryRun) {
            r.local = [...stillLocal];
            r.upstream = [];
            r.commit = FULL;
          }
          updated.push({ id: r.id, changed: files.length, files });
          log.push(`update  ${r.id} -> ${HEAD} (${files.length} file${files.length === 1 ? '' : 's'} changed upstream)`);
        }
        const unmatched = Object.keys(choices).filter((f) => !matched.has(f));
        if (!log.length) log.push(`up to date with ${HEAD}`);
        if (!json) return okOut(log.join('\n'));
        return jsonOut({
          command: 'update', ...(dryRun ? { dryRun: true } : {}), commit: FULL, updated, conflicts, merged,
          kept, skipped, gone, imported: [],
          ...(unmatched.length ? { unmatched } : {}),
          upToDate: !updated.length,
        });
      }
      case 'remove': {
        const id = positional[0];
        const i = fx.lock.findIndex((r) => r.id === id);
        if (i < 0) return errOut(`${id} is not imported here`);
        const [r] = fx.lock.splice(i, 1);
        const log = [];
        const kept = [];
        const users = fx.lock
          .map((x) => x.id)
          .filter((other) => (CATALOG.find((e) => e.id === other)?.requires ?? []).includes(id));
        if (users.length) log.push(`note    ${users.join(', ')} require${users.length === 1 ? 's' : ''} ${id}`);
        for (const f of r.local ?? []) {
          const shown = `${r.path}/${f}`;
          kept.push(shown);
          log.push(`kept    ${shown} (edited here)`);
        }
        log.push(`remove  ${id}`);
        if (!json) return okOut(log.join('\n'));
        return jsonOut({ command: 'remove', removed: id, kept, requiredBy: users, gitignore: 'unchanged' });
      }
      case 'sync':
      case 'restore': {
        const command = sub === 'restore' ? 'restore' : 'sync';
        const rows = fx.lock.filter((r) => !positional.length || positional.includes(r.id));
        const unknown = positional.find((id) => !fx.lock.some((r) => r.id === id));
        if (unknown) return errOut(`${unknown} is not imported here`);
        const log = [];
        const restored = [];
        const kept = [];
        const skipped = [];
        for (const r of rows) {
          for (const f of r.missing ?? []) {
            const shown = `${r.path}/${f}`;
            restored.push(shown);
            log.push(`restored ${shown}`);
          }
          const miss = r.missing ?? [];
          if (!dryRun) {
            r.local = (r.local ?? []).filter((f) => !miss.includes(f));
            r.missing = [];
          }
          for (const f of (r.local ?? []).filter((f) => !miss.includes(f))) kept.push(`${r.path}/${f}`);
        }
        log.push(restored.length || kept.length
          ? `${command} done: ${restored.length} file${restored.length === 1 ? '' : 's'} restored, ${kept.length} kept (edited here)`
          : `${command} done: everything already in place`);
        if (!json) return okOut(log.join('\n'));
        return jsonOut({ command, ...(dryRun ? { dryRun: true } : {}), restored, kept, skipped, pruned: [], worker: null });
      }
      case 'gitignore': {
        return okOut('gitignore: managed block up to date (fixture)');
      }
      default:
        return errOut(`unknown subcommand "${sub}"`);
    }
  }

  // ---------------------------------------------------------------- handlers

  // Callback registry behind the mocked transformCallback, so the updater
  // plugin's Channel and the startup update-event listen() work.
  let nextCallbackId = 1;
  const callbacks = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Invented release behind the updater fixture (see the +update-* flags).
  const updateMetadata = () => ({
    rid: 1,
    currentVersion: '0.1.0',
    version: UPDATE_VERSION,
    date: '2026-11-12T00:00:00Z',
    body: 'Fixture release notes for the footer updater states.',
    rawJson: { version: UPDATE_VERSION, notes: 'fixture', pub_date: '2026-11-12T00:00:00Z' },
  });

  async function mockDownloadAndInstall(a) {
    // Streams Started/Progress/Finished at the Channel the plugin passed,
    // the way the Rust side would; slow enough to screenshot mid-flight.
    const ch = a?.onEvent;
    const emit = (m) => ch?.onmessage?.(m);
    const total = 3145728;
    emit({ event: 'Started', data: { contentLength: total } });
    for (let i = 0; i < 4; i++) {
      await sleep(250);
      emit({ event: 'Progress', data: { chunkLength: total / 4 } });
    }
    await sleep(250);
    emit({ event: 'Finished', data: {} });
    return null;
  }

  const handlers = {
    // Updater plugin surface (the footer drives these; install streams
    // progress, relaunch and close are silent no-ops).
    'plugin:updater|check': async () => {
      await sleep(700);
      if (updaterMode === 'error') throw 'fixture: the release feed is unreachable (mock +update-error)';
      return updaterMode === 'available' ? updateMetadata() : null;
    },
    'plugin:updater|download_and_install': mockDownloadAndInstall,
    'plugin:process|restart': async () => null,
    'plugin:resources|close': async () => null,
    // Event listen: only the startup update event is emulated, and only
    // under +update-available (fires once, shortly after boot subscribes).
    'plugin:event|listen': async ({ event, handler }) => {
      if (event === 'stack://update-available' && updaterMode === 'available') {
        const cb = callbacks.get(handler);
        if (cb) setTimeout(() => cb({ event, payload: { version: UPDATE_VERSION } }), 400);
      }
      return nextCallbackId++;
    },
    'plugin:event|unlisten': async () => null,
    pick_folder: async () => fx.pick,
    // Adopt picker: project-relative like the real shell. matching is an
    // identical entry no scenario has imported; differing refuses in adopt3
    // (its lookalike); multi names two same-named components; outside
    // rejects the way Rust confinement does.
    pick_adopt_folder: async () => {
      switch (pickFlag) {
        case 'matching': return '.stack/systems/engineering-conventions';
        case 'differing': return '.agents/skills/ponytail';
        case 'nomatch': return 'vendor/my-own-thing';
        case 'multi': return 'handmade/button';
        case 'outside': throw 'folder is outside this project';
        case 'cancel': return null;
        default: return (fx.folders ?? [])[0] ?? 'vendor/my-own-thing';
      }
    },
    get_config: async () => structuredClone(fx.config),
    save_config: async ({ config }) => {
      fx.config = structuredClone(config);
      persistConfig();
      return null;
    },
    add_recent_project: async ({ path }) => {
      fx.config.recentProjects = [path, ...fx.config.recentProjects.filter((p) => p !== path)].slice(0, 10);
      persistConfig();
      return structuredClone(fx.config);
    },
    validate_project: async ({ path }) => fx.report(path),
    project_folders: async () => ({ folders: [...(fx.folders ?? [])] }),
    // Review-changes: the installed copy of one project file. Fixtures name the
    // edited / stale copies by project-relative path (fx.installed); any other
    // file of an imported entry reads as its upstream body, a path nothing
    // imported there as missing. The real command refuses escapes the same way.
    read_project_file: async ({ path }) => {
      if (!path || path.startsWith('/') || path.split('/').includes('..')) throw 'path escapes the project directory';
      const text = fx.installed?.[path];
      if (text === undefined) return { exists: false, size: 0, binary: false, truncated: false, text: null };
      return { exists: true, size: text.length, binary: false, truncated: false, text };
    },
    node_status: async () => ({ ...fx.node }),
    // Release version the footer shows (mirrors tauri.conf in the real app).
    'plugin:app|version': async () => '0.1.0',
    stack_run: async (a) => stack(a),
    // Real shell shape: { root?, roots?, stackDir? } ->
    // { root, roots, repos, capped }.
    scan_projects: async ({ root, roots } = {}) => {
      const picked = roots?.length ? roots : root ? [root] : ['/home/dev/projects'];
      return { root: picked[0], roots: picked, repos: structuredClone(fx.scan), capped: false };
    },
    default_scan_roots: async () => ({ roots: ['/home/dev/projects'], stackPath: '/home/dev/escacs/stack' }),
    stack_location: async () => fx.stack.valid
      ? { path: fx.stack.path, source: fx.stack.source }
      : { path: null, source: 'missing' },
    validate_stack: async () => structuredClone(fx.stack),
    // A successful provision pins the path and validates from then on (the
    // no-node scenario keeps its node error: provisioning never fixes node).
    provision_stack: async () => {
      const r = structuredClone(fx.provision);
      if (r.status !== 'manual' && r.path) {
        fx.config.stackPath = r.path;
        fx.stack = fx.node.ok
          ? { ...structuredClone(okStack), path: r.path, source: 'settings' }
          : { ...structuredClone(fx.stack), path: r.path, source: 'settings' };
      }
      return r;
    },
    stack_cli_status: async () => structuredClone(fx.cli),
    // Linking flips a missing link to linked (or bin-not-on-PATH when the
    // bin dir is off PATH); anything else is reported unchanged, like Rust.
    link_stack_cli: async () => {
      if (fx.cli.status === 'missing') {
        fx.cli = {
          status: fx.cli.onPath ? 'linked-ok' : 'bin-not-on-PATH',
          link: fx.cli.link,
          expected: fx.cli.expected,
          actual: fx.cli.expected,
          onPath: fx.cli.onPath,
          message: fx.cli.onPath
            ? `linked ${fx.cli.link} -> ${fx.cli.expected}.`
            : `linked ${fx.cli.link} -> ${fx.cli.expected}; but ~/.local/bin is not on PATH — add: export PATH="$HOME/.local/bin:$PATH", then open a new shell.`,
        };
      }
      return structuredClone(fx.cli);
    },
    t3_status: async () => ({
      available: t3Mode,
      version: t3Mode ? '0.1.7' : null,
      error: t3Mode ? null : 't3 was not found on PATH',
    }),
    t3_workspace: async ({ projectDir }) => {
      const mainRoot = '/home/dev/projects/folio';
      const cur = projectDir || mainRoot;
      if (!t3Mode) {
        return {
          t3Available: false,
          t3Version: null,
          t3Error: 't3 was not found on PATH',
          registered: false,
          mainRoot: cur,
          worktrees: [
            { path: cur, branch: 'main', detached: false, isMain: true, isT3: false, hasLock: !!fx.lock.length, isCurrent: true },
          ],
          threads: [],
        };
      }
      fx.t3Worktrees ??= [
        { path: mainRoot, branch: 'main', detached: false, isMain: true, isT3: false, hasLock: !!fx.lock.length },
        { path: '/home/dev/.t3/worktrees/folio/feat-ui', branch: 't3/feat-ui', detached: false, isMain: false, isT3: true, hasLock: true },
        { path: '/home/dev/.t3/worktrees/folio/spike', branch: 't3/spike', detached: false, isMain: false, isT3: true, hasLock: false },
      ];
      fx.t3Threads ??= [
        {
          threadId: 't3-fixture-1',
          title: 'Build Browse UI',
          status: 'idle',
          provider: 'claude-code',
          model: 'sonnet-4',
          branch: 't3/feat-ui',
          worktreePath: '/home/dev/.t3/worktrees/folio/feat-ui',
          link: 't3://thread/t3-fixture-1',
          updatedAt: '2026-11-18T00:10:00Z',
        },
        {
          threadId: 't3-fixture-2',
          title: 'Main Repo Review',
          status: 'running',
          provider: 'codex',
          model: 'gpt-5',
          branch: 'main',
          worktreePath: null,
          link: 't3://thread/t3-fixture-2',
          updatedAt: '2026-11-18T00:05:00Z',
        },
      ];
      return {
        t3Available: true,
        t3Version: '0.1.7',
        t3Error: null,
        registered: true,
        mainRoot,
        worktrees: fx.t3Worktrees.map((w) => ({ ...w, isCurrent: w.path === cur })),
        threads: structuredClone(fx.t3Threads),
      };
    },
    t3_send_thread: async ({ threadId }) => {
      const existing = fx.t3Threads?.find((t) => t.threadId === threadId);
      if (existing) existing.status = 'running';
      return {
        threadId,
        title: existing?.title ?? threadId,
        link: existing?.link ?? `t3://thread/${threadId}`,
        status: 'running',
      };
    },
    t3_start_thread: async ({ title, worktree, branch }) => {
      const id = `t3-fixture-${(fx.t3Threads?.length ?? 2) + 1}`;
      const label = title || 'Fixture thread';
      const created = {
        threadId: id,
        title: label,
        status: 'running',
        provider: 'claude-code',
        model: 'sonnet-4',
        branch: branch || (worktree ? `t3/${id}` : 'main'),
        worktreePath: worktree ? `/home/dev/.t3/worktrees/folio/${id}` : null,
        link: `t3://thread/${id}`,
        updatedAt: new Date().toISOString(),
      };
      if (fx.t3Threads) fx.t3Threads.unshift(created);
      if (worktree && fx.t3Worktrees) {
        fx.t3Worktrees.push({
          path: created.worktreePath,
          branch: created.branch,
          detached: false,
          isMain: false,
          isT3: true,
          hasLock: false,
        });
      }
      return {
        threadId: id,
        title: label,
        link: created.link,
        status: 'running',
      };
    },
  };

  // Deterministic reloads per scenario.
  try {
    localStorage.setItem('stack:mock-scenario', scenario);
  } catch {
    /* private mode: ignore */
  }

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      // Probes read every stack call the app made (and every project file it read) from here.
      if (cmd === 'stack_run') (window.__stackCalls ??= []).push({ sub: args.subcommand, args: [...(args.args ?? [])] });
      if (cmd === 'read_project_file') (window.__fileReads ??= []).push(args.path);
      const fn = handlers[cmd];
      if (!fn) {
        console.warn(`[mock-app-bridge] unknown command: ${cmd}`);
        return null;
      }
      return fn(args);
    },
    transformCallback: (cb) => {
      const id = nextCallbackId++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id) => {
      callbacks.delete(id);
    },
    // No-op event surface; the shell currently emits no events.
    listen: async () => () => {},
    emit: async () => {},
  };
})();
