#!/usr/bin/env bash
#
# STUB deploy script: provision/update a DigitalOcean droplet running the
# peerkit bootstrap/relay node. Implements GitHub issue holochain/peerkit#5
# requirement 2 ("deploy the relay to a DigitalOcean droplet").
#
# Not yet implemented. Intended flow:
#   1. Ensure the droplet exists (doctl compute droplet create ...).
#   2. Build the relay (npm ci && npm run build).
#   3. Ship dist/ + node_modules to the droplet.
#   4. (Re)start the relay service (systemd unit).
#
# Required environment:
#   DIGITALOCEAN_ACCESS_TOKEN  DigitalOcean API token
#   DROPLET_NAME               Target droplet name
#   PEERKIT_NETWORK_SECRET     Shared network secret for the relay

set -euo pipefail

: "${DIGITALOCEAN_ACCESS_TOKEN:?DIGITALOCEAN_ACCESS_TOKEN is required}"
: "${DROPLET_NAME:?DROPLET_NAME is required}"
: "${PEERKIT_NETWORK_SECRET:?PEERKIT_NETWORK_SECRET is required}"

echo "STUB: would deploy '${DROPLET_NAME}' to DigitalOcean"
echo "STUB: implement droplet provisioning and relay rollout here"
exit 0
