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
// imports), manyfresh (15 presets, no stack.toml), lots (36 presets). A
// `+update-available` or `+update-error` suffix on any scenario drives the
// footer updater fixture (e.g. `#populated+update-available,/project`):
// the former answers checks with 0.1.9 and fires the startup update event,
// the latter fails checks.
(() => {
  'use strict';

  const rawScenario = ((location.hash || '#populated').slice(1).split(',')[0] || '').split('/')[0] || 'populated';
  const [scenario, ...flags] = rawScenario.split('+');
  // Footer updater fixture: 'available' offers 0.1.9 (check answers it and
  // the startup event fires), 'error' fails checks, otherwise up to date.
  const updaterMode = flags.includes('update-available')
    ? 'available'
    : flags.includes('update-error')
      ? 'error'
      : 'none';
  const UPDATE_VERSION = '0.1.9';

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
    return base;
  };

  const entryFileBody = (e, path) => {
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

  const statusJson = (rows) => ({
    command: 'status',
    commit: FULL,
    rows: rows.map((r) => ({
      id: r.id, path: r.path, commit: r.commit,
      local: [...(r.local ?? [])], upstream: [...(r.upstream ?? [])], gone: !!r.gone,
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
        error: "'/home/dev/escacs/stack' is not a usable stack checkout: . Install Node.js 22 or newer, then relaunch the app.",
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
        { id: 'skills/file-pr', commit: 'a1b2c3d000000000000000000000000000000000', path: '.agents/skills/file-pr', local: ['SKILL.md'], upstream: ['SKILL.md', 'helpers.mjs'] },
        { id: 'styles/folio-light', commit: `${HEAD}00000000000000000000000000000000000`, path: '.agents/skills/folio-light', local: [], upstream: [] },
        { id: 'templates/agents-md', commit: 'a1b2c3d000000000000000000000000000000000', path: '.', local: [], upstream: ['files/AGENTS.md'] },
      ],
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
    // First-run gate: nothing validates, the app must show StackSetup.
    'bad-stack': () => ({
      config: { ...baseConfig, stackPath: null, worker: null, project: null },
      node: { ok: true, version: 'v22.14.0', major: 22, error: null },
      stack: {
        path: '', valid: false, source: 'missing',
        git: false, cli: false,
        node: { ok: true, version: 'v22.14.0', major: 22, error: null },
        error: 'no escacs/stack checkout found: looked upward from the app, its install folder and the working folder for tools/stack/cli.mjs. Pick your stack clone (the folder containing tools/stack/cli.mjs), or set ESCACS_STACK to it.',
      },
      report: (path) => ({ path, valid: true, markers: [], errors: [] }),
      lock: [],
      uncommitted: [],
      noWorkers: false,
      scan: [],
      pick: null,
    }),
  };

  const fx = (SCENARIOS[scenario] ?? SCENARIOS.populated)();
  const presets = () => fx.presets ?? PRESETS;
  const okOut = (stdout) => ({ stdout, stderr: '', code: 0, truncated: false });
  const errOut = (stderr, code = 1) => ({ stdout: '', stderr, code, truncated: false });
  const jsonOut = (v) => okOut(JSON.stringify(v, null, 2));

  // ------------------------------------------------------- stack_run router
  // Emulates the shell: parse --json/--/--kind/--to like build_argv, then
  // answer in the real CLI shapes (JSON when asked, text otherwise).

  function splitArgs(args) {
    const out = { json: false, dryRun: false, kind: null, to: null, file: null, positional: [] };
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
      out.positional.push(a);
    }
    return out;
  }

  const kindMatch = (e, kind) =>
    !kind || e.id.split('/')[0] === `${kind}s` || (kind === 'component' && e.id.startsWith('components/'));

  function stack({ subcommand: sub, args = [] }) {
    if (!fx.node.ok) return errOut('node 22+ is required (fixture: no-node scenario)');
    const { json, dryRun, kind, to, file, positional } = splitArgs(args);
    const visible = CATALOG.filter((e) => !(fx.noWorkers && e.id.startsWith('workers/')));
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
        const log = [];
        const imported = [];
        const already = [];
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
          const clash = !to && fx.lookalikeFor?.[id];
          if (clash) {
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
        if (action === 'list') {
          const rows = presets().map((p) => ({ name: p.name, description: p.description, imports: p.imports }));
          if (!json) return okOut(rows.length ? rows.map((p) => `- ${p.name}: ${p.description}`).join('\n') : 'No presets.');
          return jsonOut({ command: 'preset', action: 'list', count: rows.length, presets: rows });
        }
        if (action === 'show') {
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
            const clash = !imp.to && !fx.lock.some((r) => r.id === imp.id) && fx.lookalikeFor?.[imp.id];
            if (clash) conflicts.push(...clash);
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
        const log = [];
        const updated = [];
        const conflicts = [];
        const merged = [];
        const kept = [];
        const skipped = [];
        const gone = [];
        for (const r of rows) {
          if (r.gone) {
            gone.push(r.id);
            log.push(`gone    ${r.id} was removed from the stack; kept as is (\`stack remove ${r.id}\` to drop it)`);
            continue;
          }
          if (!r.upstream?.length) continue;
          const both = r.upstream.filter((f) => r.local?.includes(f));
          const clean = r.upstream.filter((f) => !r.local?.includes(f));
          for (const f of both) {
            const shown = `${r.path}/${f}`;
            conflicts.push(shown);
            log.push(`CONFLICT ${shown} (1 conflict; resolve the <<<<<<< markers)`);
          }
          merged.push(...clean.map((f) => `${r.path}/${f}`));
          if (both.length) r.local = [...new Set([...(r.local ?? []), ...r.upstream])];
          else r.local = (r.local ?? []).filter((f) => !r.upstream.includes(f));
          const changed = both.length + clean.length;
          r.upstream = [];
          r.commit = FULL;
          updated.push({ id: r.id, changed });
          log.push(`update  ${r.id} -> ${HEAD} (${changed} file${changed === 1 ? '' : 's'} changed upstream)`);
        }
        if (!log.length) log.push(`up to date with ${HEAD}`);
        if (!json) return okOut(log.join('\n'));
        return jsonOut({
          command: 'update', commit: FULL, updated, conflicts, merged,
          kept, skipped, gone, imported: [],
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
      case 'sync': {
        const log = [];
        const restored = [];
        const kept = [];
        const skipped = [];
        for (const r of fx.lock) {
          for (const f of r.missing ?? []) {
            const shown = `${r.path}/${f}`;
            restored.push(shown);
            log.push(`restored ${shown}`);
          }
          r.local = (r.local ?? []).filter((f) => !(r.missing ?? []).includes(f));
          r.missing = [];
          for (const f of r.local ?? []) kept.push(`${r.path}/${f}`);
        }
        log.push(restored.length || kept.length
          ? `sync done: ${restored.length} file${restored.length === 1 ? '' : 's'} restored, ${kept.length} kept (edited here)`
          : 'sync done: everything already in place');
        if (!json) return okOut(log.join('\n'));
        return jsonOut({ command: 'sync', restored, kept, skipped });
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
    get_config: async () => structuredClone(fx.config),
    save_config: async ({ config }) => {
      fx.config = structuredClone(config);
      return null;
    },
    add_recent_project: async ({ path }) => {
      fx.config.recentProjects = [path, ...fx.config.recentProjects.filter((p) => p !== path)].slice(0, 10);
      return structuredClone(fx.config);
    },
    validate_project: async ({ path }) => fx.report(path),
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
  };

  // Deterministic reloads per scenario.
  try {
    localStorage.setItem('stack:mock-scenario', scenario);
  } catch {
    /* private mode: ignore */
  }

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
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
