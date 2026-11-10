# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-10

First public release.

### Added
- Admin panel (ru / en / de / fr, PWA): VM start / stop with auto-stop on idle, live status, RCON console, grouped cvars, game modes and map presets, 120+ Workshop maps, map vote, practice tools and callouts for 10 maps, skins / knives / gloves / agents, sound player (in the panel and on the server), per-player statistics, team names / logos / clan tags, plugin catalogue, backups and restore, audit log.
- Agent for the game VM: config rendering from a single `state.json`, RCON, plugins, skins, statistics, nightly and shutdown backups to Object Storage.
- Infrastructure as code for Yandex Cloud (OpenTofu / Terraform) and a deterministic deploy bundle.
- Demo mode (`npm run demo`): the real panel on a mock game server, no cloud account needed.
- GitHub Actions: CI (tests on Node 20 and 22, bundle size check, frontend type check and build, Terraform checks, gitleaks), CodeQL, Release (bundle, frontend archive, checksums, provenance attestation), optional continuous deployment.
- Documentation in English and Russian, security policy, contributing guide.

### Security
- Continuous deployment is off by default and runs only for pushes to `main` of the same repository.
- Terraform state backend, admin list and all identifiers are configuration, not code.
