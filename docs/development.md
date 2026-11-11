# Development

You need **Node.js 18+** and a POSIX shell. Terraform is only needed to work on `terraform/`.

```bash
git clone https://github.com/sink3x/cs2-server-admin-panel.git && cd cs2-server-admin-panel
npm test           # backend, agent, state, i18n, security, demo: node:test, no dependencies
npm run demo       # the real panel on a mock game server: http://127.0.0.1:8080
```

Demo logins: `admin` / `demo-admin-pass` and `player` / `demo-player-pass`. The demo binds to `127.0.0.1` only and is excluded from the VM bundle (`scripts/pack.sh`).

## Layout

See [stack.md](stack.md) for the map of the repository and "I want to change X, where do I look". The short version:

| You want to work on | Directory | Run |
|---|---|---|
| Panel backend | `app/admin/server.js`, `app/lib/` | `npm test`, `npm run demo` |
| Classic pages | `app/admin/public/` | reload the demo |
| Preact + TypeScript islands | `web/` | `cd web && npm ci && npm run dev` (rebuilds into `app/admin/public/ui/`), `npm run typecheck` |
| Agent | `app/agent/` | `npm test` (agent tests use fakes, no game needed) |
| Infrastructure | `terraform/` | `tofu fmt -recursive`, `tofu init -backend=false && tofu validate` |
| Installers / boot | `common/`, `vm-admin/`, `vm-cs2/` | read the scripts; they are idempotent |

## Tests

- `npm test` runs every file in `app/test/` with `node --test`. Add a `*.test.js` next to the others; no framework to learn.
- `demo.test.js` starts the whole panel with the mock agent, logs in over HTTP and checks roles. Use it as a template for API tests.
- `i18n.test.js` checks the translation dictionaries.
- CI runs the tests on Node 20 and 22, builds the bundle (which fails if it grows beyond the metadata limit), type-checks and builds the frontend, validates Terraform and scans for secrets.

## Common tasks

**Add a translation.** Source strings are Russian. Add `['русская строка', 'English', 'Deutsch', 'Français']` to the newest `app/admin/public/i18n-extra*.js`. Template literals with `${}` are not translated: use `tr()` around the static parts.

**Add a Workshop map.** Add to `WORKSHOP_MAPS` in `app/lib/presets.js` (id, name, categories, tags, preview). `catalog-practice.test.js` and `workshop.test.js` check the shape.

**Add a panel page.** Classic: a `pages-*.js` file, registered in `shell.js`. New pages are better written as Preact islands in `web/src/` (types, components). Add the API route in `app/admin/server.js` with a role check and a test.

**Change a server option.** Validate it in `app/lib/state.js` (`validateState`), render it in the matching `render*` function, add a case to `state.test.js` / `apply.test.js`.

**Add a plugin to the catalogue.** [plugins.md](plugins.md#adding-your-own-entry).

## Build a deploy bundle by hand

```bash
scripts/pack.sh      # build/bundle.tgz (+ build/public/): deterministic, prints sizes and hashes
```

## Commits and pull requests

- Keep a change focused; add or update a test with it.
- `npm test` and `tofu fmt -check -recursive` must pass locally; CI repeats them.
- Describe *why* in the pull request. Screenshots help for UI changes.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full list, including how to report a security issue privately.

## Releases

1. Move the items under `## [Unreleased]` in `CHANGELOG.md` to a new `## [x.y.z] - date` section and bump `version` in `package.json`.
2. Commit, then `git tag vX.Y.Z && git push --tags`.
3. The **Release** workflow runs the tests, builds `bundle.tgz` and the public frontend archive, writes `SHA256SUMS`, attaches a build provenance attestation and publishes a GitHub Release with the changelog section as the notes. It can also be started by hand from the Actions tab with a tag.

Verify a download: `sha256sum -c SHA256SUMS` and `gh attestation verify <file> -R sink3x/cs2-server-admin-panel`.
