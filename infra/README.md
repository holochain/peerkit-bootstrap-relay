# infra

One-shot droplet provisioning. `cloud-init.yaml` sets machine state once at
first boot. No day-2 config management: to change config, **redeploy** from an
edited copy. The deploy is driven by the manually-triggered
`.github/workflows/deploy.yml`.

Runs one systemd service on one DigitalOcean droplet:

| Service       | Unit            | Port(s)  |
| ------------- | --------------- | -------- |
| PeerKit relay | `peerkit-relay` | 4001/tcp |

## Deploy

Run the **Deploy relay** workflow (Actions -> Run workflow). Inputs:
`repo_ref` (relay version to build), `region`, `size`. Each run renders
`cloud-init.yaml`, creates a fresh droplet (immutable model), delivers the
network secret and persisted relay certificate over SSH, and reassigns the
Reserved IP to the new droplet, then destroys the droplets that held the name
before the run. Teardown happens only after the Reserved IP moved, so a failure
at any earlier step leaves the old droplet serving traffic.

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

The relay's announced multiaddr stays stable across droplet replacements
because the **Reserved IP** is reassigned to each new droplet and the
**persisted certificate** keeps the certhash constant. No DNS is involved.

## Secrets handling

- The network secret and the relay cert private key are delivered **over SSH**
  after boot, so neither lands in the droplet's DO user-data (which is readable
  on-box via the metadata service by any local process).
- The relay boots with an ephemeral certificate; the deploy restarts it after
  delivering the persisted cert so it adopts the stable certhash.

## Operating

```bash
systemctl status peerkit-relay
journalctl -u peerkit-relay -f
```

The relay logs structured JSON at startup; the `relay ready` line carries its
full multiaddr - read it from `journalctl -u peerkit-relay` to configure
clients.
