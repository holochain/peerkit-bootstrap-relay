/**
 * @fileoverview Entry point. Wires CLI to relay service.
 */

import { readFileSync } from "node:fs";

import { run as runRelay, type RelayConfig } from "@peerkit/relay";
import { parseCli, CliError } from "./cli.js";
import { verifyNetworkAccessBytes } from "./network-access.js";

interface PackageJson {
  readonly version: string;
}

const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageJson;
const RELAY_VERSION = PACKAGE_JSON.version;

async function main(): Promise<void> {
  let cliArgs: ReturnType<typeof parseCli>;
  try {
    cliArgs = parseCli(process.argv.slice(2), process.env);
  } catch (error: unknown) {
    if (error instanceof CliError) {
      process.stderr.write(`CLI error: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  // make relay config
  const config: RelayConfig = {
    id: cliArgs.id,
    logLevel: cliArgs.logLevel,
    listenAddrs: cliArgs.listenAddrs,
    networkAccessBytes: cliArgs.networkSecret,
    networkAccessHandler: async (_nodeId, bytes) =>
      verifyNetworkAccessBytes(cliArgs.networkSecret, bytes),
    publicHost: cliArgs.publicHost,
    otel: cliArgs.otel
      ? {
          otlpEndpoint: cliArgs.otel.otlpEndpoint,
          exportIntervalMs: cliArgs.otel.exportIntervalMs,
          headers: cliArgs.otel.headers,
          serviceVersion: RELAY_VERSION,
        }
      : undefined,
  };

  await runRelay(config);
}

main().catch((error) => {
  process.stderr.write(
    `Fatal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
