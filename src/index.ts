/**
 * @fileoverview Entry point for the peerkit bootstrap/relay node.
 */

import { loadConfig } from "./config.js";
import { startRelay } from "./relay.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await startRelay(config);
}

main().catch((error: unknown) => {
  console.error("[relay] fatal", error);
  process.exitCode = 1;
});
