# peerkit-bootstrap-relay

Bootstrap/relay node for [peerkit](https://github.com/holochain/peerkit)
networks. It provides a stable, publicly reachable circuit-relay-v2 server so
peers behind NAT can be discovered and connected. Built for the peerkit
showcase app and Wind Tunnel test runs (see
[holochain/peerkit#5](https://github.com/holochain/peerkit/issues/5)).

> **Status: stub.** Networking wraps peerkit's relay transport, but the
> network-access scheme and the DigitalOcean deployment are placeholders.

## How it works

The relay wraps `createRelay` from `@peerkit/transport-libp2p-nodejs`. A relay
handles the access and agents protocols (no message protocol) and acts as a
circuit-relay-v2 server. Every inbound connection must pass the
`/peerkit/access/v1` handshake before anything else.

## Requirements

- Node.js `>=22`

## peerkit dependency

The peerkit packages are not yet published to npm, so `@peerkit/api` and
`@peerkit/transport-libp2p-nodejs` point at the peerkit git repository in
`package.json`. peerkit is a workspaces monorepo, so a plain git dependency
installs the whole repo but does **not** expose the individual scoped
packages as importable modules. Until peerkit publishes to a registry,
building the relay sources requires the peerkit packages to be built and
linked locally (`npm link`). This is the current stub limitation; swap in
registry versions once peerkit publishes.

## Install

```bash
npm ci
```

## Build

```bash
npm run build
```

## Run

```bash
PEERKIT_NETWORK_SECRET=<shared-secret> npm start
```

| Variable                     | Default                   | Description                       |
| ---------------------------- | ------------------------- | --------------------------------- |
| `PEERKIT_NETWORK_SECRET`     | _(required)_              | Shared secret for network access  |
| `PEERKIT_RELAY_ID`           | `peerkit-bootstrap-relay` | Log identifier                    |
| `PEERKIT_RELAY_LISTEN_ADDRS` | TCP 4001 (v4 + v6)        | Comma-separated listen multiaddrs |

## Network access bytes

Compute the access bytes a client must present, from the shared secret:

```bash
npm run compute-network-access -- <network-secret>
```

## Deployment

Manual deploy to a DigitalOcean droplet runs via the `Deploy` GitHub Actions
workflow (`workflow_dispatch`, takes the target app version) and is
implemented in `scripts/deploy.sh`. Both are stubs pending the real
provisioning flow.

## Development

```bash
npm run lint       # eslint
npm run fmt        # prettier --write
npm run fmt:check  # prettier --check
npm test           # vitest
```

`husky` + `lint-staged` run prettier and eslint on staged files at commit
time (installed via the `prepare` script on `npm install`).

## License

[CAL-1.0](./LICENSE) — same as peerkit.
