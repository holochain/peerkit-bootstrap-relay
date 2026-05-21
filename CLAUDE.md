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
  logLevel, otel). Throws `CliError` on bad input; caller maps to exit code 2.
- `src/network-access.ts` — STUB derivation of `NetworkAccessBytes` via
  sha256(secret). Replace with the real scheme from peerkit
  `SPECIFICATIONS.md` before production use.
- `scripts/deploy.sh` — DigitalOcean droplet rollout.

## Deployment

`scripts/deploy.sh` performs a zero-downtime rollout to a DigitalOcean droplet
over SSH. It is driven by the `Deploy` GitHub Actions workflow
(`.github/workflows/deploy.yml`) but is runnable standalone.

Required env: `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY_PATH`,
`DEPLOY_KNOWN_HOSTS_PATH`, `RELEASE_REF`, `PEERKIT_NETWORK_SECRET`. Optional:
`PEERKIT_OTEL_OTLP_ENDPOINT`, `PEERKIT_OTEL_HEADERS`, `PEERKIT_PUBLIC_HOST`,
`PEERKIT_RELAY_LISTEN_ADDRS` (derived from `DEPLOY_SSH_HOST` if unset).

`@peerkit/relay` does not expose an HTTP endpoint, so readiness and the
relay-info payload are read from the systemd journal rather than HTTP.

Flow: build (`npm ci && npm run build`); rsync `dist`, `node_modules`, and
manifests into `/opt/peerkit-relay/releases/<short-sha>`; write
`/etc/peerkit-relay/env` (`root:peerkit-relay`, `0640`); stop the service,
swap the `current` symlink, start it; wait for active (30s), then poll
`journalctl -u peerkit-relay` for the `relay ready` log line (5×, 2s) —
rollback to the previous release on failure; extract the `relay ready` JSON
into `relay-multiaddr.txt`; prune all but the last 3 releases. The droplet
runs the relay under the `peerkit-relay` systemd unit and requires
`sudo journalctl` in the deploy user's NOPASSWD allowlist.

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
