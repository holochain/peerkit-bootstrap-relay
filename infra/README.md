# infra

One long-lived DigitalOcean droplet, reused across deploys.

- `cloud-init.yaml` - base machine only (packages, Node.js 22, `peerkit` user,
  firewall). Runs **once**, when the droplet is first created.
- `deploy.sh` - everything that tracks the deployed commit: checkout, build,
  systemd unit, non-secret env, restart. Runs over SSH on **every** deploy.
  It, the unit and the env template are copied to the droplet together, so
  machine state comes from the branch the workflow runs from even when
  `repo_ref` points at an older relay commit.
- `peerkit-relay.service` - the systemd unit, reinstalled on every deploy.
- `relay.env.tmpl` - non-secret env, re-rendered on every deploy.

Runs one systemd service on that droplet:

| Service       | Unit            | Port(s)  |
| ------------- | --------------- | -------- |
| PeerKit relay | `peerkit-relay` | 4001/tcp |

## Deploy

Run the **Deploy relay** workflow (Actions -> Run workflow). Inputs:
`repo_ref` (relay version to build), `region`, `size`, `recreate`.

A normal run looks up the droplet named `peerkit-bootstrap-relay`, creates it
only if it is missing, delivers the network secret and persisted relay
certificate over SSH, runs `deploy.sh` on-box, and makes sure the Reserved IP
points at the droplet. Nothing is destroyed and no droplet piles up.

### Changing the base machine

`cloud-init.yaml` only runs at first boot, so edits to it do not reach a
running droplet. Deploy with `recreate: true`: the workflow renames the current
droplet to `peerkit-bootstrap-relay-old-<sha>`, builds a replacement, and moves
the Reserved IP to it. The old droplet keeps running - reassign the Reserved IP
back to roll back, then delete it manually. Exactly one droplet may carry the
name `peerkit-bootstrap-relay`; the deploy fails fast if it finds more.

### Required GitHub secrets

| Secret                      | Purpose                                |
| --------------------------- | -------------------------------------- |
| `DIGITALOCEAN_ACCESS_TOKEN` | `doctl` auth                           |
| `DO_SSH_KEY_FINGERPRINTS`   | comma-separated SSH key fingerprints   |
| `DO_SSH_PRIVATE_KEY`        | private key the workflow SSHes in with |
| `PEERKIT_NETWORK_SECRET`    | relay network access secret            |
| `RELAY_CERT_JSON`           | persisted `RelayCertificate` JSON      |

### Required GitHub variable

| Variable      | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| `RESERVED_IP` | pre-allocated DO Reserved IP announced as the public host |

### One-time setup

Provision under **Settings -> Secrets and variables -> Actions**:

1. **DigitalOcean** - create an API token with read/write
   (`DIGITALOCEAN_ACCESS_TOKEN`). Upload each operator's SSH **public** key to
   the DO account; collect the fingerprints into `DO_SSH_KEY_FINGERPRINTS`.
   Put the **private** key for one of them in `DO_SSH_PRIVATE_KEY`.
2. **Reserved IP** - allocate one once and store it as the `RESERVED_IP`
   variable:

   ```bash
   doctl compute reserved-ip create --region ams3
   ```

3. **Relay certificate** - generate once, locally, and store the JSON verbatim
   as the `RELAY_CERT_JSON` secret. The certhash it prints is baked into peers'
   dial multiaddrs; it stays stable for 5 years. Use `--silent` so npm's banner
   does not pollute the JSON:

   ```bash
   npm run --silent gen-cert > relay-cert.json
   ```

4. **Network secret** - pick a value and store it as `PEERKIT_NETWORK_SECRET`.

## Stable address

The relay's announced multiaddr stays stable because the droplet is reused, the
**Reserved IP** always ends up assigned to it, and the **persisted
certificate** keeps the certhash constant. No DNS is involved.

## On-box layout

| Path                                        | Contents                               |
| ------------------------------------------- | -------------------------------------- |
| `/opt/peerkit-bootstrap-relay`              | git checkout, built by `deploy.sh`     |
| `/opt/peerkit-bootstrap-relay/certs`        | persisted relay certificate            |
| `/etc/peerkit-relay.env`                    | non-secret env, re-rendered per deploy |
| `/etc/peerkit-relay.secrets.env`            | network secret, delivered over SSH     |
| `/etc/systemd/system/peerkit-relay.service` | unit, reinstalled per deploy           |

## Secrets handling

- The network secret and the relay cert private key are delivered **over SSH**
  after boot, so neither lands in the droplet's DO user-data (which is readable
  on-box via the metadata service by any local process).
- Secrets live in their own `EnvironmentFile`, so re-rendering the non-secret
  env on each deploy cannot drop them. Rotating a secret takes effect on the
  next deploy.

## Operating

```bash
systemctl status peerkit-relay
journalctl -u peerkit-relay -f
```

The relay logs structured JSON at startup; the `relay ready` line carries its
full multiaddr - read it from `journalctl -u peerkit-relay` to configure
clients.
