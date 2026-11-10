# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository
(<https://github.com/sink3x/cs2-yc-sandbox/security/advisories/new>).

Include what you found, how to reproduce it and the affected version or commit. You will get an answer within a few days; fixes are released as a patch version and credited in the changelog unless you prefer otherwise.

Supported versions: the latest release and `main`.

## Threat model

| Boundary | Protection |
|---|---|
| Internet to panel (Caddy, HTTPS, HSTS) | Password login (scrypt) or Steam OpenID; failed-login rate limiting; session cookie `HttpOnly; SameSite=Strict; Secure`; CSRF header required on every non-GET request |
| Player to admin | The `player` role is limited to an allow-list of routes (`PLAYER_OK`) and to its own SteamID (`SELF_ONLY`) |
| Panel to agent on the game VM | Bearer token; port 8081 is open only to the panel's security group |
| Game process (user `steam`, third-party plugins) to everything else | No access to the VM metadata service (`vm-cs2/block-metadata.sh`); agent and S3 secrets are root-only files |
| Deploy from CI | Off unless `DEPLOY_ENABLED=true`; only for pushes to `main` of the same repository; secrets in a protected `production` environment; never from pull requests |

## Hardening already in place

- Steam logins never auto-link to a panel account by nickname or "the only free account"; linking is explicit.
- User lookup is prototype-safe (`__proto__`, `constructor` are ordinary names).
- Static files: unknown paths are not cached; directory traversal is checked strictly.
- CSP includes `base-uri 'none'`, `form-action 'self'`, `object-src 'none'`.
- Steam OpenID: the signature must cover `claimed_id`, `identity`, `return_to`, `response_nonce` and `op_endpoint`; `openid.ns` is verified.
- The audit log never stores secrets from RCON commands (`sv_password ...` becomes `sv_password [hidden]`).
- Restoring a backup validates the archive first: only files and directories, no `..`, absolute paths or links.
- The panel's public URL comes from the config, not from the `Host` header; the initial password file is removed from disk after the accounts are created.
- CI runs CodeQL and gitleaks; Dependabot watches npm, Actions and Terraform providers; GitHub Actions are pinned by commit SHA (CodeQL and attestation actions by tag).

## Known and accepted risks

- **Third-party game plugins** (Metamod, CounterStrikeSharp, WeaponPaints, MatchZy, ...) are downloaded from GitHub releases at install time and run inside the game process. The metadata block limits the damage but does not replace pinning versions (`pin` in `app/lib/plugins.json`) and checking checksums.
- **Initial passwords** stay in the panel VM's metadata and in the Terraform state. After you change them in the panel, clear `panel_users` from your secrets (existing accounts are not affected). Protect the Terraform state: it contains every secret of the deployment.
- **Service account scope**: roles (`storage.editor`, `compute.operator`, `storage.viewer`) are granted on the folder, not on single resources. Run the stack in a dedicated folder.
- **The agent speaks plain HTTP** inside the private subnet; protection is the token and the security group.
- **`deploy.yml` installs the `yc` CLI with `curl | bash`** from Yandex Cloud's storage.
- **Login lockout by user name** (`user:<name>`) lets an outsider block one user's logins for 10 minutes. This is a deliberate trade-off against password guessing.
- **Skin changers** (WeaponPaints) violate Valve's server guidelines; see [docs/plugins.md](docs/plugins.md#skins-read-this-before-you-enable-weaponpaints).

The audit notes from November 2026 in Russian: [docs/ru/security-audit.md](docs/ru/security-audit.md).
