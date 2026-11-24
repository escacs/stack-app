Real `stack ... --json` output used by `src/realCli.test.ts`.

Recorded by driving the actual CLI (the upgraded `tools/stack`) in a throwaway
git project against a throwaway copy of the stack (the original is never
touched): init, import 4 skills, edit/delete files in the project, commit
upstream changes in the copy, then status, `update --dry-run` with
`--keep-mine`/`--take-upstream`, `restore`, `update`, and a few failures
(`*.txt` = stderr). `meta.json` holds the argv of each run.

Re-record: `node <gen.mjs> <path-to-stack> src/__fixtures__ <scratch-dir>`
(the generator is kept at docs/record-fixtures.mjs).
