#!/usr/bin/env node
// AIRBNB-10.6 — script entry point, no public exports.
//
// Compute the network access bytes for a peerkit network from a shared secret.
// STUB: SHA-256 of the secret; mirrors src/network-access.ts. The real scheme
// (peerkit SPECIFICATIONS.md, `NetworkAccessBytes`) is not yet implemented.
//
// Usage:
//   node scripts/compute-network-access.mjs <network-secret>
//   PEERKIT_NETWORK_SECRET=... node scripts/compute-network-access.mjs

import { createHash } from "node:crypto";

const secret = process.argv[2] ?? process.env.PEERKIT_NETWORK_SECRET;

if (!secret) {
  console.error(
    "usage: compute-network-access.mjs <network-secret> " +
      "(or set PEERKIT_NETWORK_SECRET)",
  );
  process.exitCode = 1;
} else {
  const bytes = createHash("sha256").update(secret).digest();
  console.log(`hex:    ${bytes.toString("hex")}`);
  console.log(`base64: ${bytes.toString("base64")}`);
}
