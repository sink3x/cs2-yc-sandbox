# Contributing

Thanks for helping! Issues, ideas, translations, docs and code are all welcome. English and Russian are both fine in issues and pull requests.

## Quick start

```bash
git clone https://github.com/sink3x/cs2-yc-sandbox.git && cd cs2-yc-sandbox
npm test          # no dependencies to install
npm run demo      # real panel + mock game server on http://127.0.0.1:8080
```

Everything about the code layout, tests and common tasks (new translation, map, page, plugin) is in **[docs/development.md](docs/development.md)** and **[docs/stack.md](docs/stack.md)**.

## Before you open a pull request

1. Open an issue first for anything larger than a small fix, so we agree on the direction.
2. Keep the change focused. Add or update a test (`app/test/`).
3. Run `npm test`. If you touched `terraform/`, also `tofu fmt -recursive` and `tofu init -backend=false && tofu validate`. If you touched `web/`, `cd web && npm ci && npm run typecheck`.
4. UI text is **Russian first** with `en`, `de`, `fr` translations in `app/admin/public/i18n-extra*.js`. A new string needs all four.
5. The backend and the agent have **no npm dependencies** on purpose. Please do not add any; talk to us first if you think one is needed.
6. Describe *why* in the pull request. Screenshots for UI changes.

## Commit messages

Short imperative subject (`Add map vote cooldown`), optional body with the reason. No need for a special format.

## Security issues

Do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Porting to another cloud

The panel and the agent are cloud-agnostic except `app/lib/yc.js` (start / stop the VM) and the Terraform module. A new provider means a new Terraform module under `terraform/` and an adapter with the same interface as `yc.js`. Open an issue to discuss before starting.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
