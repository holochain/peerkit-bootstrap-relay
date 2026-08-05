# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

`peerkit-bootstrap-relay` is a single-package Node.js + TypeScript service: a
bootstrap/relay node for [peerkit](https://github.com/holochain/peerkit)
networks. It exists to support the peerkit showcase app and Wind Tunnel tests
(see [holochain/peerkit#5](https://github.com/holochain/peerkit/issues/5)).

The relay implementation itself lives in `@peerkit/relay` (npm). This package
is now only a thin CLI/env shell around `@peerkit/relay`'s `run(RelayConfig)`
entry point.

## Architecture

- `src/index.ts` — entry point. Parses CLI/env via `parseCli`, builds a
  `RelayConfig`, then `await`s `run()` from `@peerkit/relay`. The library
  handles logger, metrics, agent store, relay startup, signal handlers, and
  graceful shutdown. Network-access verification uses
  `crypto.timingSafeEqual` to avoid timing leaks on the network secret.
- `src/cli.ts` — `parseCli` function. Reads `--flag` and `PEERKIT_*` env vars;
  returns validated `CliArgs` (id, listenAddrs, networkSecret, publicHost,
  certificate, logLevel, otel). The optional `certificate` is read from a JSON
  file (`--certificate-file` / `PEERKIT_RELAY_CERTIFICATE_FILE`) and validated
  into a `RelayCertificate`. Throws `CliError` on bad input; caller maps to
  exit code 2.
- `src/network-access.ts` — STUB derivation of `NetworkAccessBytes` via
  sha256(secret). Replace with the real scheme from peerkit
  `SPECIFICATIONS.md` before production use.
- `scripts/gen-cert.mjs` — prints a fresh `RelayCertificate` JSON
  (`npm run gen-cert`) for use as the persisted relay certificate.

## Deployment

The relay runs on ONE long-lived DigitalOcean droplet, named
`peerkit-bootstrap-relay`, driven by the manual `Deploy relay` workflow
(`.github/workflows/deploy.yml`). The droplet is **reused** on every deploy:
the workflow looks it up by name, creates it only when missing, delivers
`PEERKIT_NETWORK_SECRET` and the persisted relay certificate over SSH (so
neither lands in DO user-data), runs `infra/deploy.sh` on-box, and ensures the
Reserved IP is assigned to it.

The split matters:

- `infra/cloud-init.yaml` — base machine only (packages, Node.js, `peerkit`
  user, firewall). Runs once, at droplet creation, and has no placeholders.
- `infra/deploy.sh` — everything commit-dependent: fetch/checkout the resolved
  SHA, `npm install`, `npm run build`, install `infra/peerkit-relay.service`,
  render `infra/relay.env.tmpl` to `/etc/peerkit-relay.env`, restart, verify
  the unit is still active 15s later. Copied from the runner's checkout, not
  run out of `/opt` (it rewrites that checkout).
- Secrets live in a separate `EnvironmentFile`
  (`/etc/peerkit-relay.secrets.env`) that `deploy.sh` never rewrites, so
  re-rendering the non-secret env cannot drop them.

Editing `cloud-init.yaml` does not reach a running droplet: deploy with
`recreate: true`, which renames the old droplet to
`peerkit-bootstrap-relay-old-<sha>`, builds a replacement, and moves the
Reserved IP. The old droplet stays up for rollback and is deleted manually.
Exactly one droplet may hold the base name; the deploy fails fast otherwise.

`@peerkit/relay` does not expose an HTTP endpoint, so readiness is read from
the container logs (`journalctl -u peerkit-relay`) rather than HTTP.

Operator steps: allocate the Reserved IP once and store it as the `RESERVED_IP`
Actions variable; `npm run --silent gen-cert` and store the JSON as the
`RELAY_CERT_JSON` secret; set `PEERKIT_NETWORK_SECRET`,
`DIGITALOCEAN_ACCESS_TOKEN`, `DO_SSH_KEY_FINGERPRINTS`, and `DO_SSH_PRIVATE_KEY`
secrets; run the `Deploy relay` workflow. See `infra/README.md` for the full
runbook.

## peerkit dependency

`@peerkit/relay` is pinned to an alpha release on the npm registry
(currently `0.1.0-alpha.14`). It transitively pulls in `@peerkit/api`,
`@peerkit/peerkit`, `@peerkit/metrics`, `@peerkit/agent-store`, and the
libp2p Node.js transport. Do not invent peerkit APIs:

- `@peerkit/relay` exports `run(RelayConfig): Promise<void>` (high-level
  one-shot entry) plus `startRelay`, `createLogger`, `initRelayMetrics`,
  `shutdownRelayMetrics`, `setAgentCountProvider`,
  `generateRelayCertificate`, and types `RelayConfig`, `OtelConfig`,
  `RunningRelay`, `StartRelayDeps`, `RelayCertificate`. `run()` owns logger +
  metrics + `MemoryAgentStore` + relay startup + SIGINT/SIGTERM handlers and
  calls `process.exit` on shutdown.
- `RelayConfig` requires `listenAddrs`, `networkAccessBytes`,
  `networkAccessHandler`. Optional: `id`, `logLevel`, `publicIp`,
  `otel`, `certificate`. `OtelConfig` requires `otlpEndpoint` and
  `serviceVersion`; optional `exportIntervalMs`, `headers`.
- The agents protocol (cbor decode, Ed25519 verify, store, replay) is owned
  by `PeerkitRelayBuilder` inside `@peerkit/peerkit` and reached through
  `startRelay`; do not re-implement it here.

## Commands

- Install: `npm install`
- Build: `npm run build` (`tsc --build tsconfig.build.json`)
- Lint: `npm run lint`
- Format: `npm run fmt` / check with `npm run fmt:check`
- Test: `npm test` (vitest)

### CI checks

Do not run CI checks unless explicitly asked. When asked, run what
`.github/workflows/test.yml` runs:

- `npm run lint`
- `npm run lint:md`
- `npm run fmt:check`
- `npm run build`
- `npm test`

## Conventions

- TypeScript: Google style. `strict`, `verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`. ESM with `.js` import extensions even for `.ts`
  sources. No `any`; `unknown` for caught errors.
- GitHub Actions: third-party actions pinned by tag.
- Markdown: markdownlint rules; tables use the aligned style (run
  `fmt-md-tables -i <file>` after editing tables).
- husky + lint-staged enforce prettier/eslint on staged files at commit.

## Git

- Do not add `Co-Authored-By` trailers to commits (global user rule).
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
  `test:`, `ci:`).
