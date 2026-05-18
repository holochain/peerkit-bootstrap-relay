# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

`peerkit-bootstrap-relay` is a single-package Node.js + TypeScript service: a
bootstrap/relay node for [peerkit](https://github.com/holochain/peerkit)
networks. It exists to support the peerkit showcase app and Wind Tunnel tests
(see [holochain/peerkit#5](https://github.com/holochain/peerkit/issues/5)).

This is currently a **stub**. The networking path wraps peerkit's relay
transport, but the network-access scheme (`src/network-access.ts`,
`scripts/compute-network-access.mjs`) and the DigitalOcean deployment
(`scripts/deploy.sh`, `.github/workflows/deploy.yml`) are placeholders.

## Architecture

- `src/index.ts` — entry point. Loads config, starts the relay.
- `src/config.ts` — `RelayConfig` loaded from `PEERKIT_*` env vars.
- `src/relay.ts` — wraps `createRelay` from
  `@peerkit/transport-libp2p-nodejs`. A relay handles only the access and
  agents protocols and runs a circuit-relay-v2 server; it does not handle the
  message protocol. Every inbound connection must clear the
  `/peerkit/access/v1` handshake first.
- `src/network-access.ts` — STUB derivation/verification of
  `NetworkAccessBytes`. Replace with the real scheme from peerkit
  `SPECIFICATIONS.md` before production use.
- `scripts/compute-network-access.mjs` — CLI mirroring the stub derivation.
- `scripts/deploy.sh` — STUB DigitalOcean droplet rollout.

## peerkit dependency

`@peerkit/api` and `@peerkit/transport-libp2p-nodejs` are not published to
npm. They point at the peerkit git repo in `package.json`. peerkit is a
workspaces monorepo, so a git dependency installs the whole repo but does not
expose the scoped packages as importable modules — `npm run build` of the
relay sources requires the peerkit packages built and `npm link`ed until
peerkit publishes to a registry. Swap in registry versions then. Do not
invent peerkit APIs:
the transport contract lives in peerkit `packages/api/src/transport.ts`
(`createRelay` options require `networkAccessHandler`,
`peerConnectedCallback`, `agentsReceivedCallback`).

## Commands

- Install: `npm install`
- Build: `npm run build` (`tsc --build`)
- Lint: `npm run lint`
- Format: `npm run fmt` / check with `npm run fmt:check`
- Test: `npm test` (vitest)
- Compute access bytes: `npm run compute-network-access -- <secret>`

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
- GitHub Actions: third-party actions pinned by full commit SHA; run `zizmor
.github/workflows/` until zero findings after any workflow change.
- Markdown: markdownlint rules; tables use the aligned style (run
  `fmt-md-tables -i <file>` after editing tables).
- husky + lint-staged enforce prettier/eslint on staged files at commit.

## Git

- Do not add `Co-Authored-By` trailers to commits (global user rule).
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
