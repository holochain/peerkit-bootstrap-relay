/**
 * @fileoverview Network access bytes computation and verification.
 *
 * peerkit gates every inbound connection behind a raw-bytes handshake on
 * `/peerkit/access/v1`. A relay must present the network's
 * {@link NetworkAccessBytes} and decide which peers to admit. This module is a
 * STUB: it derives access bytes from a shared secret and admits any peer whose
 * presented bytes match. Replace with the real network-access scheme before
 * production use.
 */

import { createHash } from "node:crypto";
import type { NetworkAccessBytes } from "@peerkit/api";

/**
 * Compute the {@link NetworkAccessBytes} for a network identified by
 * `networkSecret`.
 *
 * STUB: SHA-256 of the secret. The real scheme (see peerkit SPECIFICATIONS.md,
 * `NetworkAccessBytes`) is not yet implemented here.
 */
export function computeNetworkAccessBytes(
  networkSecret: string,
): NetworkAccessBytes {
  return new Uint8Array(createHash("sha256").update(networkSecret).digest());
}

/**
 * Constant-time-ish comparison of two byte sequences.
 *
 * STUB: length check plus byte-wise compare. Not hardened against timing
 * side-channels — adequate only for the showcase/test relay.
 */
export function bytesEqual(
  a: NetworkAccessBytes,
  b: NetworkAccessBytes,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
