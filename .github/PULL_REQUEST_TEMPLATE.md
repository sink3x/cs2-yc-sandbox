## What and why

<!-- A short description. Link the issue if there is one. -->

## Checklist

- [ ] `cd app && node --test` passes (new behaviour has a test)
- [ ] UI text is Russian in the source and has `en`/`de`/`fr` translations (`app/admin/public/i18n-extra*.js`)
- [ ] `scripts/pack.sh` still passes (the VM bundle must stay under the metadata limit)
- [ ] Docs updated (`docs/`, README) if behaviour or configuration changed
- [ ] No secrets, real IPs, SteamIDs or personal data in the diff
