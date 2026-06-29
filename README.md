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
current `listenAddrs` and `peerId`, read from the container logs
(`journalctl -u peerkit-relay`) to publish the bootstrap multiaddr (see
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
| `--certificate-file`         | `PEERKIT_RELAY_CERTIFICATE_FILE`  | _(optional)_                               | Path to a relay certificate JSON file (see Deployment)         |
| `--log-level`                | `PEERKIT_LOG_LEVEL`               | `info`                                     | Log level (`trace`, `debug`, `info`, `warn`, `error`)          |
| `--otel-otlp-endpoint`       | `PEERKIT_OTEL_OTLP_ENDPOINT`      | _(optional; presence enables OTLP export)_ | OTLP gRPC/HTTP endpoint for OpenTelemetry metrics              |
| `--otel-export-interval-ms`  | `PEERKIT_OTEL_EXPORT_INTERVAL_MS` | `60000`                                    | OTLP export interval in milliseconds                           |
| `--otel-headers`             | `PEERKIT_OTEL_HEADERS`            | _(optional)_                               | OTLP request headers as comma-separated `k=v` pairs            |

## Discovery

Clients are configured with the relay's multiaddr out-of-band as a well-known
bootstrap address, typically a WebRTC-Direct multiaddr
`/ip4/<ip>/udp/<port>/webrtc-direct/certhash/<hash>/p2p/<peer-id>`.

On startup the relay logs a `relay ready` JSON line containing its current
`listenAddrs` and `peerId`. Read it from the container logs
(`journalctl -u peerkit-relay`) to publish or refresh the bootstrap address
(see [Deployment](#deployment)).

> **Note:** Supplying a persisted relay certificate (see
> [Relay certificate](#relay-certificate)) keeps the WebRTC-Direct certhash —
> and therefore the dialable multiaddr — stable across restarts and droplet
> replacements. Without one the certificate is ephemeral and the certhash
> changes on every restart.

## Deployment

The relay is deployed as a DigitalOcean droplet provisioned by
[`infra/cloud-init.yaml`](./infra/cloud-init.yaml) and driven by the manual
[`Deploy relay`](./.github/workflows/deploy.yml) GitHub Actions workflow. Each
run builds the relay from a chosen git ref on a fresh droplet, delivers the
network secret and the persisted relay certificate over SSH, and reassigns a
DigitalOcean Reserved IP so the announced multiaddr stays stable across
replacements. See [`infra/README.md`](./infra/README.md) for the full runbook.

`@peerkit/relay` does not expose an HTTP endpoint, so readiness is read from
the container logs (`journalctl -u peerkit-relay`) rather than HTTP; the
`relay ready` line carries the announced multiaddr.

### Relay certificate

`@peerkit/relay` generates an ephemeral WebRTC-Direct certificate on every
start, so the certhash — and the dialable multiaddr — change on each restart.
Supplying a persisted certificate keeps them stable. Generate one once and
store it as the `RELAY_CERT_JSON` GitHub secret (the `--silent` flag keeps
npm's banner out of the JSON):

```bash
npm run --silent gen-cert > relay-cert.json
```

The certificate is valid for 5 years; re-mint it and update the secret before
it expires.

### Reading the announced multiaddr

On startup the relay logs a `relay ready` JSON line with its `listenAddrs` and
`peerId`. Read it from the droplet and record the announced multiaddr for
client bootstrap configuration:

```bash
journalctl -u peerkit-relay
```

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
