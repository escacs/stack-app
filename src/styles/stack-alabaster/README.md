Vendored copy of the stack-alabaster style (`styles/stack-alabaster/tokens.css`)
and the component CSS (`components/stack-alabaster/<name>/<name>.css`) from the
escacs/stack checkout, copied byte for byte. Do not edit; the dark values are the
app-owned `tokens-dark.css`, and app-only styling lives in `src/app.css`.

The components' TSX is not used: it needs solid-js 2 + `@ui-sdk/solid`, and
this app is on solid-js 1.9. `src/ui.tsx` emits the same `sa-*` class names.

Re-sync with `stack import` once the stack's alabaster entries are committed
(the CLI refuses uncommitted entries), e.g.
`stack import styles/stack-alabaster --to src/styles/stack-alabaster`.
