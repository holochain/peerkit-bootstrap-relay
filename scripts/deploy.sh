#!/usr/bin/env bash
#
# Deploy peerkit bootstrap/relay to a DigitalOcean droplet.
# Companion to .claude/docs/deploy.md.
#
# Required environment:
#   DEPLOY_SSH_HOST            target host / DNS name
#   DEPLOY_SSH_USER            ssh user (unprivileged, sudo NOPASSWD on narrow commands)
#   DEPLOY_SSH_KEY_PATH        path to private key
#   DEPLOY_KNOWN_HOSTS_PATH    path to known_hosts file pinning the host key
#   RELEASE_REF                tag/branch/sha being deployed (informational)
#   PEERKIT_NETWORK_SECRET     shared network secret for the relay
#
# Optional environment:
#   PEERKIT_OTEL_OTLP_ENDPOINT
#   PEERKIT_OTEL_HEADERS
#   PEERKIT_PUBLIC_HOST
#   PEERKIT_RELAY_LISTEN_ADDRS  comma-separated libp2p listen multiaddrs

set -euo pipefail

: "${DEPLOY_SSH_HOST:?DEPLOY_SSH_HOST required}"
: "${DEPLOY_SSH_USER:?DEPLOY_SSH_USER required}"
: "${DEPLOY_SSH_KEY_PATH:?DEPLOY_SSH_KEY_PATH required}"
: "${DEPLOY_KNOWN_HOSTS_PATH:?DEPLOY_KNOWN_HOSTS_PATH required}"
: "${RELEASE_REF:?RELEASE_REF required}"
: "${PEERKIT_NETWORK_SECRET:?PEERKIT_NETWORK_SECRET required}"

SHA="$(git rev-parse HEAD)"
SHORT_SHA="${SHA:0:12}"
RELEASE_DIR="/opt/peerkit-relay/releases/${SHORT_SHA}"
CURRENT_LINK="/opt/peerkit-relay/current"

SSH_OPTS=(
  -i "${DEPLOY_SSH_KEY_PATH}"
  -o "UserKnownHostsFile=${DEPLOY_KNOWN_HOSTS_PATH}"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
)
SSH_TARGET="${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}"

ssh_cmd() {
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "$@"
}

log() {
  printf '==> %s\n' "$*"
}

log "deploying ref=${RELEASE_REF} sha=${SHORT_SHA} to ${SSH_TARGET}"

# 1. Build release artifacts locally. CI already runs `npm ci && npm run build`
#    in earlier steps; re-running here keeps the script usable standalone.
log "build release"
npm ci
npm run build

# 2. Ensure release dir exists.
log "prepare ${RELEASE_DIR}"
ssh_cmd "mkdir -p ${RELEASE_DIR}"

# 3. Ship release tree via rsync (dist + runtime deps + manifests).
#    Build the -e command with shell-quoted SSH_OPTS so paths containing
#    whitespace/special chars survive rsync's word-splitting.
log "rsync release"
RSYNC_SSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
  RSYNC_SSH+=" $(printf '%q' "${opt}")"
done
rsync -az --delete -e "${RSYNC_SSH}" \
  dist node_modules package.json package-lock.json \
  "${SSH_TARGET}:${RELEASE_DIR}/"

# 4. Write /etc/peerkit-relay/env (root:peerkit-relay, 0640).
log "write /etc/peerkit-relay/env"
ENV_BODY="PEERKIT_NETWORK_SECRET=${PEERKIT_NETWORK_SECRET}"
if [[ -n "${PEERKIT_OTEL_OTLP_ENDPOINT:-}" ]]; then
  ENV_BODY+=$'\n'"PEERKIT_OTEL_OTLP_ENDPOINT=${PEERKIT_OTEL_OTLP_ENDPOINT}"
fi
if [[ -n "${PEERKIT_OTEL_HEADERS:-}" ]]; then
  ENV_BODY+=$'\n'"PEERKIT_OTEL_HEADERS=${PEERKIT_OTEL_HEADERS}"
fi
if [[ -n "${PEERKIT_PUBLIC_HOST:-}" ]]; then
  ENV_BODY+=$'\n'"PEERKIT_PUBLIC_HOST=${PEERKIT_PUBLIC_HOST}"
fi
# If listen addrs not explicitly provided, derive from DEPLOY_SSH_HOST so the
# /relay-info multiaddr advertises the reachable address instead of 0.0.0.0.
LISTEN_ADDRS="${PEERKIT_RELAY_LISTEN_ADDRS:-}"
if [[ -z "${LISTEN_ADDRS}" ]]; then
  if [[ "${DEPLOY_SSH_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    LISTEN_ADDRS="/ip4/${DEPLOY_SSH_HOST}/tcp/4001"
  elif [[ "${DEPLOY_SSH_HOST}" =~ : ]]; then
    LISTEN_ADDRS="/ip6/${DEPLOY_SSH_HOST}/tcp/4001"
  else
    LISTEN_ADDRS="/dns4/${DEPLOY_SSH_HOST}/tcp/4001"
  fi
fi
ENV_BODY+=$'\n'"PEERKIT_RELAY_LISTEN_ADDRS=${LISTEN_ADDRS}"

printf '%s\n' "${ENV_BODY}" | ssh_cmd "sudo /usr/bin/tee /etc/peerkit-relay/env >/dev/null \
  && sudo /usr/bin/chown root:peerkit-relay /etc/peerkit-relay/env \
  && sudo /usr/bin/chmod 0640 /etc/peerkit-relay/env"

# Capture previous release for rollback.
PREV_TARGET="$(ssh_cmd "readlink ${CURRENT_LINK} 2>/dev/null || true")"

rollback() {
  if [[ -n "${PREV_TARGET}" && "${PREV_TARGET}" != "${RELEASE_DIR}" ]]; then
    log "rolling back to ${PREV_TARGET}"
    ssh_cmd "ln -sfn ${PREV_TARGET} ${CURRENT_LINK}" || true
    ssh_cmd "sudo /usr/bin/systemctl restart peerkit-relay" || true
  else
    log "no previous release to roll back to"
  fi
}

# 5-7. Stop, swap symlink, start.
log "stop service"
ssh_cmd "sudo /usr/bin/systemctl stop peerkit-relay" || true

log "swap current -> ${RELEASE_DIR}"
ssh_cmd "ln -sfn ${RELEASE_DIR} ${CURRENT_LINK}"

log "start service"
if ! ssh_cmd "sudo /usr/bin/systemctl start peerkit-relay"; then
  rollback
  exit 1
fi

# 8. Wait for active (timeout 30s).
log "wait for active"
if ! ssh_cmd "timeout 30 bash -c 'until systemctl is-active --quiet peerkit-relay; do sleep 1; done'"; then
  ssh_cmd "sudo /usr/bin/systemctl status peerkit-relay --no-pager || true" >&2
  rollback
  exit 1
fi

# 9. Healthcheck — wait for the "relay ready" log line (retry 5x, 2s).
#    @peerkit/relay does not expose HTTP; readiness is signalled in the
#    structured log on stdout, captured by journald.
log "healthcheck (journalctl)"
READY_OK=0
for _ in 1 2 3 4 5; do
  if ssh_cmd "sudo /usr/bin/journalctl -u peerkit-relay --since '5 minutes ago' --no-pager -o cat | grep -q 'relay ready'"; then
    READY_OK=1
    break
  fi
  sleep 2
done
if [[ "${READY_OK}" -ne 1 ]]; then
  ssh_cmd "sudo /usr/bin/systemctl status peerkit-relay --no-pager || true" >&2
  rollback
  exit 1
fi

# 10. Extract relay-ready JSON from the journal; persist for the workflow
#     artifact. Field layout matches the "relay ready" log line:
#     { nodeId, multiaddrs, startedAt }.
log "extract relay-info from journal"
RELAY_INFO="$(ssh_cmd "sudo /usr/bin/journalctl -u peerkit-relay --since '5 minutes ago' --no-pager -o cat | grep 'relay ready' | tail -1")"
printf '%s\n' "${RELAY_INFO}"
printf '%s\n' "${RELAY_INFO}" > relay-multiaddr.txt

# 11. Prune releases — keep last 3.
log "prune old releases"
ssh_cmd "ls -1dt /opt/peerkit-relay/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf"

log "deployed sha=${SHORT_SHA}"
