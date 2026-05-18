/**
 * @fileoverview Relay configuration loaded from environment variables.
 */

/**
 * Resolved configuration for a bootstrap/relay node.
 */
export interface RelayConfig {
  /** Human-readable identifier attached to log records. */
  readonly id: string;
  /** libp2p multiaddrs the relay listens on. */
  readonly listenAddrs: readonly string[];
  /** Shared secret used to derive the network access bytes. */
  readonly networkSecret: string;
}

const DEFAULT_LISTEN_ADDRS: readonly string[] = [
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
];

/**
 * Load {@link RelayConfig} from the environment.
 *
 * - `PEERKIT_RELAY_ID` — log identifier (default `"peerkit-bootstrap-relay"`).
 * - `PEERKIT_RELAY_LISTEN_ADDRS` — comma-separated multiaddrs.
 * - `PEERKIT_NETWORK_SECRET` — shared network secret (required).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const networkSecret = env.PEERKIT_NETWORK_SECRET;
  if (!networkSecret) {
    throw new Error("PEERKIT_NETWORK_SECRET is required");
  }

  const listenAddrs = env.PEERKIT_RELAY_LISTEN_ADDRS
    ? env.PEERKIT_RELAY_LISTEN_ADDRS.split(",").map((addr) => addr.trim())
    : DEFAULT_LISTEN_ADDRS;

  return {
    id: env.PEERKIT_RELAY_ID ?? "peerkit-bootstrap-relay",
    listenAddrs,
    networkSecret,
  };
}
