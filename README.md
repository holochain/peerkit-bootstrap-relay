# peerkit-bootstrap-relay

Bootstrap/relay node for [peerkit](https://github.com/holochain/peerkit)
networks. It provides a stable, publicly reachable circuit-relay-v2 server so
peers behind NAT can be discovered and connected. Built for the peerkit
showcase app and Wind Tunnel test runs (see
[holochain/peerkit#5](https://github.com/holochain/peerkit/issues/5)).

> **Note:** The network-access-bytes derivation scheme (`src/network-access.ts`)
> is a stub. Replace it with the real scheme from peerkit `SPECIFICATIONS.md`
> before production use.

## How it works

The relay is built with `PeerkitRelayBuilder` from `@peerkit/peerkit`, which
wraps the libp2p relay transport. A relay handles the access and agents
protocols (no message protocol) and acts as a circuit-relay-v2 server. Every
inbound connection must pass the `/peerkit/access/v1` handshake before anything
else.

On the agents protocol the builder cbor-decodes each inbound agent-info
payload, verifies its Ed25519 signature, and stores the verified records in an
in-memory `MemoryAgentStore` (from `@peerkit/agent-store`). When a new peer
connects, the relay replays the full store to it. Records are evicted purely by
each record's own `expiresAt`; the relay imposes no TTL or entry cap and does
not drop records when a peer disconnects.

On startup the relay emits a `relay ready` JSON log line containing its
current `listenAddrs` and `peerId`. The deploy pipeline reads this from the
systemd journal to publish the bootstrap multiaddr (see
[Discovery](#discovery)).

## Requirements

- Node.js `>=22`

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

All options can be supplied as CLI flags or environment variables. CLI flags
take precedence over environment variables, which take precedence over defaults.

| Flag                         | Env var                           | Default                                    | Description                                                    |
| ---------------------------- | --------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `--id`                       | `PEERKIT_RELAY_ID`                | `peerkit-bootstrap-relay`                  | Log / metrics identifier                                       |
| `--listen-addr` (repeatable) | `PEERKIT_RELAY_LISTEN_ADDRS`      | `/ip4/0.0.0.0/tcp/4001,/ip6/::/tcp/4001`   | libp2p listen multiaddrs; env value is comma-separated         |
| `--network-secret`           | `PEERKIT_NETWORK_SECRET`          | _(required; prefer env var)_               | Shared secret for network-access handshake                     |
| `--public-host`              | `PEERKIT_PUBLIC_HOST`             | _(optional)_                               | Publicly reachable hostname advertised in announced multiaddrs |
| `--log-level`                | `PEERKIT_LOG_LEVEL`               | `info`                                     | Log level (`debug`, `info`, `warn`, `error`)                   |
| `--otel-otlp-endpoint`       | `PEERKIT_OTEL_OTLP_ENDPOINT`      | _(optional; presence enables OTLP export)_ | OTLP gRPC/HTTP endpoint for OpenTelemetry metrics              |
| `--otel-export-interval-ms`  | `PEERKIT_OTEL_EXPORT_INTERVAL_MS` | `60000`                                    | OTLP export interval in milliseconds                           |
| `--otel-headers`             | `PEERKIT_OTEL_HEADERS`            | _(optional)_                               | OTLP request headers as comma-separated `k=v` pairs            |

## Discovery

Clients are configured with the relay's multiaddrs out-of-band as a well-known
bootstrap address typically `/dns4/<public-host>/tcp/<port>/p2p/<peer-id>`
or the bare `/ip4/.../tcp/<port>` listen address.

On startup the relay logs a `relay ready` JSON line containing its current
`listenAddrs` and `peerId`. The deploy pipeline (see
[Deployment](#deployment)) extracts this line from the systemd journal into
`relay-multiaddr.txt` so the published bootstrap address can be refreshed
after each rollout.

> **Note:** The relay's `PeerId` is volatile. It is regenerated on every
> restart until peerkit's transport accepts a persistent private key. The
> published bootstrap multiaddr must be refreshed after each restart.

## Deployment

[`scripts/deploy.sh`](./scripts/deploy.sh) performs a zero-downtime rollout to
a DigitalOcean droplet over SSH. It is driven by the `Deploy` GitHub Actions
workflow ([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml),
`workflow_dispatch` with a `ref` input) but is runnable standalone.

`@peerkit/relay` does not expose an HTTP endpoint, so readiness and the
relay-info payload are read from the systemd journal rather than HTTP.

### Droplet prerequisites

- A `peerkit-relay` systemd unit running the relay, reading its environment
  from `/etc/peerkit-relay/env`, with `current` symlinked to the active release
  under `/opt/peerkit-relay/releases/<short-sha>`.
- An unprivileged deploy user whose `sudo` NOPASSWD allowlist covers
  `systemctl start|stop|restart|status peerkit-relay`, `journalctl -u
peerkit-relay`, and `tee`/`chown`/`chmod` on `/etc/peerkit-relay/env`.
- The host key pinned in a `known_hosts` file (the script uses
  `StrictHostKeyChecking=yes`).

### Environment

| Variable                     | Required | Description                                                |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| `DEPLOY_SSH_HOST`            | yes      | Target host / DNS name                                     |
| `DEPLOY_SSH_USER`            | yes      | SSH user (unprivileged, narrow sudo NOPASSWD)              |
| `DEPLOY_SSH_KEY_PATH`        | yes      | Path to the private key                                    |
| `DEPLOY_KNOWN_HOSTS_PATH`    | yes      | Path to a `known_hosts` file pinning the host key          |
| `RELEASE_REF`                | yes      | Tag/branch/sha being deployed (informational)              |
| `PEERKIT_NETWORK_SECRET`     | yes      | Shared network secret for the relay                        |
| `PEERKIT_OTEL_OTLP_ENDPOINT` | no       | OTLP endpoint for OpenTelemetry metrics                    |
| `PEERKIT_OTEL_HEADERS`       | no       | OTLP request headers (comma-separated `k=v`)               |
| `PEERKIT_PUBLIC_HOST`        | no       | Public hostname advertised in announced multiaddrs         |
| `PEERKIT_RELAY_LISTEN_ADDRS` | no       | Listen multiaddrs; derived from `DEPLOY_SSH_HOST` if unset |

### Rollout flow

1. Build artifacts locally (`npm ci && npm run build`).
2. `rsync` `dist`, `node_modules`, `package.json`, and `package-lock.json` into
   `/opt/peerkit-relay/releases/<short-sha>`.
3. Write `/etc/peerkit-relay/env` (`root:peerkit-relay`, `0640`). When
   `PEERKIT_RELAY_LISTEN_ADDRS` is unset, derive it from `DEPLOY_SSH_HOST`
   (`/ip4`, `/ip6`, or `/dns4` on `tcp/4001`).
4. Stop the service, swap the `current` symlink, and start it.
5. Wait for the unit to become active (30s timeout).
6. Poll `journalctl -u peerkit-relay` for the `relay ready` log line (5×, 2s).
7. On any failure in steps 4-6, roll back to the previous release.
8. Extract the `relay ready` JSON into `relay-multiaddr.txt` (uploaded as a
   workflow artifact).
9. Prune all but the last 3 releases.

### Running standalone

```bash
DEPLOY_SSH_HOST=relay.example.com \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY_PATH=~/.ssh/id_relay \
DEPLOY_KNOWN_HOSTS_PATH=~/.ssh/known_hosts_relay \
RELEASE_REF=main \
PEERKIT_NETWORK_SECRET=<shared-secret> \
bash scripts/deploy.sh
```

In CI the same variables are supplied from repository secrets; the workflow
also installs the SSH key and `known_hosts` from `DEPLOY_SSH_KEY` and
`DEPLOY_KNOWN_HOSTS` secrets before invoking the script.

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
