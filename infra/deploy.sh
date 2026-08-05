#!/usr/bin/env bash
# On-box deploy for the PeerKit bootstrap/relay droplet.
#
# Runs as root over SSH, driven by .github/workflows/deploy.yml. The droplet is
# long-lived and reused across deploys: cloud-init.yaml only prepares the base
# machine (node, peerkit user, firewall), and everything version-dependent -
# checkout, build, systemd unit, non-secret env - is (re)applied here on every
# run. That keeps a redeploy a restart rather than a droplet replacement.
#
# Copied to the droplet from the runner's checkout rather than executed out of
# /opt, because it rewrites that checkout while running.
#
# Required env:
#   COMMIT_SHA   full git commit the relay is built from
#   RESERVED_IP  DO Reserved IP announced as the relay's public host
#
# Secrets are NOT handled here. The workflow writes
# /etc/peerkit-relay.secrets.env and the persisted relay certificate over SSH
# before invoking this script; both are left untouched.
set -euo pipefail

REPO_URL=https://github.com/holochain/peerkit-bootstrap-relay.git
REPO_DIR=/opt/peerkit-bootstrap-relay
SECRETS_FILE=/etc/peerkit-relay.secrets.env

: "${COMMIT_SHA:?COMMIT_SHA is required}"
: "${RESERVED_IP:?RESERVED_IP is required}"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "error: $SECRETS_FILE is missing; the workflow must deliver secrets first" >&2
  exit 1
fi

# --- checkout the exact commit ---
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --depth 1 origin "$COMMIT_SHA"
git -C "$REPO_DIR" checkout --detach "$COMMIT_SHA"
# Drop files left by the previously deployed commit. certs/ holds the persisted
# relay certificate and node_modules is restored by npm below; everything else
# untracked is build residue.
git -C "$REPO_DIR" clean -xfd -e certs -e node_modules
chown -R peerkit:peerkit "$REPO_DIR"

# --- build ---
# `npm install`, not `npm ci`: npm 11 omits cross-platform optional binaries
# from the lock file, so `npm ci` refuses to proceed.
run_as_peerkit() {
  sudo -u peerkit env HOME=/var/lib/peerkit "$@"
}
(cd "$REPO_DIR" && run_as_peerkit npm install --no-audit --no-fund)
(cd "$REPO_DIR" && run_as_peerkit npm run build)

# --- machine state that tracks the deployed commit ---
install -m 0644 "$REPO_DIR/infra/peerkit-relay.service" /etc/systemd/system/peerkit-relay.service
# Rendered to a temp file first so a failed substitution cannot leave a
# half-written env file behind.
tmp_env=$(mktemp)
trap 'rm -f "$tmp_env"' EXIT
sed "s|__RESERVED_IP__|${RESERVED_IP}|g" "$REPO_DIR/infra/relay.env.tmpl" > "$tmp_env"
install -o root -g peerkit -m 0640 "$tmp_env" /etc/peerkit-relay.env
chown root:peerkit "$SECRETS_FILE"
chmod 0640 "$SECRETS_FILE"

# --- restart ---
systemctl daemon-reload
systemctl enable peerkit-relay
systemctl restart peerkit-relay

# A unit that dies on a bad build restarts every RestartSec, so an immediate
# is-active check can pass on a relay that never stays up. Sample after the
# restart window instead.
sleep 15
if ! systemctl is-active --quiet peerkit-relay; then
  echo "error: peerkit-relay is not running after deploy" >&2
  systemctl status peerkit-relay --no-pager --full || true
  journalctl -u peerkit-relay -n 100 --no-pager || true
  exit 1
fi

echo "peerkit-relay running commit ${COMMIT_SHA}"
