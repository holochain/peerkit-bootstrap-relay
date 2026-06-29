/**
 * @fileoverview CLI parser. Returns a fully resolved RelayConfig.
 *
 * Precedence: CLI flag > environment variable > default.
 * Validation errors throw CliError; caller maps to exit code 2.
 */

import { readFileSync } from "node:fs";

import meow from "meow";
import { type RelayCertificate } from "@peerkit/relay";
import { computeNetworkAccessBytes } from "./network-access.js";

/** Allowed log-level values. */
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/** Regex that matches /ip4/<addr>/tcp/<port> and /ip6/<addr>/tcp/<port>. */
const MULTIADDR_RE = /^\/ip[46]\/[^/]+\/tcp\/(\d+)$/;

const DEFAULT_OTEL_EXPORT_INTERVAL_MS = 60_000;

const INT_RE = /^\d+$/;

function parsePositiveInt(name: string, raw: string): number {
  if (!INT_RE.test(raw)) {
    throw new CliError(`--${name} must be a positive integer, got ${raw}`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`--${name} must be a positive integer, got ${raw}`);
  }
  return n;
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new CliError(`--otel-headers entry "${trimmed}" must be k=v`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key.length === 0) {
      throw new CliError(`--otel-headers entry "${trimmed}" must be k=v`);
    }
    out[key] = value;
  }
  return out;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** Required string fields of a serialized {@link RelayCertificate}. */
const CERTIFICATE_FIELDS = [
  "privateKeyPem",
  "certificatePem",
  "certhash",
] as const;

/**
 * Read and validate a JSON certificate file holding a {@link RelayCertificate}
 * ({@code privateKeyPem}, {@code certificatePem}, {@code certhash}). Throws
 * {@link CliError} when the file is unreadable, not valid JSON, or missing any
 * non-empty string field.
 */
function parseCertificateFile(path: string): RelayCertificate {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`failed to read certificate file "${path}": ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `certificate file "${path}" is not valid JSON: ${reason}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CliError(`certificate file "${path}" must contain a JSON object`);
  }

  const record = parsed as Record<string, unknown>;
  for (const field of CERTIFICATE_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new CliError(
        `certificate file "${path}" is missing a non-empty string "${field}"`,
      );
    }
  }

  return {
    privateKeyPem: record.privateKeyPem as string,
    certificatePem: record.certificatePem as string,
    certhash: record.certhash as string,
  };
}

const DEFAULT_LISTEN_ADDRS: readonly string[] = [
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
];

const DEFAULTS = {
  id: "peerkit-bootstrap-relay",
  logLevel: "info",
} as const;

const HELP_TEXT = `
  Usage: peerkit-relay [options]

  Options
    --id <string>                     Relay node ID               [env: PEERKIT_RELAY_ID]
    --listen-addr <multiaddr>...      Listen address(es)          [env: PEERKIT_RELAY_LISTEN_ADDRS]
    --network-secret <string>         Network secret (required)   [env: PEERKIT_NETWORK_SECRET]
    --public-host <host>              Public hostname             [env: PEERKIT_PUBLIC_HOST]
    --certificate-file <path>         Relay certificate JSON file [env: PEERKIT_RELAY_CERTIFICATE_FILE]
    --log-level <level>               Log level                   [env: PEERKIT_LOG_LEVEL]
    --otel-otlp-endpoint <url>        OTLP metrics endpoint       [env: PEERKIT_OTEL_OTLP_ENDPOINT]
    --otel-export-interval-ms <ms>    OTLP export interval in ms  [env: PEERKIT_OTEL_EXPORT_INTERVAL_MS]
    --otel-headers <k=v,...>          OTLP request headers        [env: PEERKIT_OTEL_HEADERS]
    -h, --help                        Show this help message
    -v, --version                     Print the version
`;

interface OtelConfig {
  otlpEndpoint: string;
  exportIntervalMs?: number;
  headers?: Record<string, string>;
}

export interface CliArgs {
  id: string;
  listenAddrs: string[];
  networkSecret: Uint8Array;
  publicHost?: string;
  certificate?: RelayCertificate;
  logLevel: string;
  otel?: OtelConfig;
}

export function parseCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): CliArgs {
  const cli = meow(HELP_TEXT, {
    importMeta: import.meta,
    argv: [...argv],
    allowUnknownFlags: false,
    flags: {
      id: { type: "string" },
      listenAddr: { type: "string", isMultiple: true },
      networkSecret: { type: "string" },
      publicHost: { type: "string" },
      certificateFile: { type: "string" },
      logLevel: { type: "string" },
      otelOtlpEndpoint: { type: "string" },
      otelExportIntervalMs: { type: "string" },
      otelHeaders: { type: "string" },
    },
  });
  const flags = cli.flags;

  const networkSecret = flags.networkSecret ?? env.PEERKIT_NETWORK_SECRET;
  if (!networkSecret) {
    throw new CliError(
      "PEERKIT_NETWORK_SECRET (or --network-secret) is required",
    );
  }
  if (flags.networkSecret) {
    process.stderr.write(
      "[warn] passing --network-secret via CLI is discouraged; " +
        "prefer the PEERKIT_NETWORK_SECRET env var\n",
    );
  }

  const listenAddrs =
    flags.listenAddr && flags.listenAddr.length > 0
      ? flags.listenAddr
      : env.PEERKIT_RELAY_LISTEN_ADDRS
        ? env.PEERKIT_RELAY_LISTEN_ADDRS.split(",").map((s) => s.trim())
        : [...DEFAULT_LISTEN_ADDRS];

  for (let i = 0; i < listenAddrs.length; i++) {
    const addr = listenAddrs[i];
    if (addr === undefined) continue;
    const match = MULTIADDR_RE.exec(addr);
    if (!match) {
      throw new CliError(
        `--listen-addr[${i}] "${addr}" is not a valid /ip4/ or /ip6/ TCP multiaddr`,
      );
    }
    const portRaw = match[1];
    if (portRaw === undefined) {
      throw new CliError(
        `--listen-addr[${i}] "${addr}" is not a valid /ip4/ or /ip6/ TCP multiaddr`,
      );
    }
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CliError(
        `--listen-addr[${i}] "${addr}" has TCP port out of range [1, 65535]`,
      );
    }
  }

  const otelEndpoint = flags.otelOtlpEndpoint ?? env.PEERKIT_OTEL_OTLP_ENDPOINT;
  let otel: OtelConfig | undefined;
  if (otelEndpoint) {
    try {
      new URL(otelEndpoint);
    } catch {
      throw new CliError(
        `--otel-otlp-endpoint must be a valid URL, got ${otelEndpoint}`,
      );
    }
    const intervalRaw =
      flags.otelExportIntervalMs ??
      env.PEERKIT_OTEL_EXPORT_INTERVAL_MS ??
      String(DEFAULT_OTEL_EXPORT_INTERVAL_MS);
    const headersRaw = flags.otelHeaders ?? env.PEERKIT_OTEL_HEADERS;
    otel = {
      otlpEndpoint: otelEndpoint,
      exportIntervalMs: parsePositiveInt(
        "otel-export-interval-ms",
        intervalRaw,
      ),
      headers: headersRaw ? parseHeaders(headersRaw) : undefined,
    };
  }

  const certificateFile =
    flags.certificateFile ?? env.PEERKIT_RELAY_CERTIFICATE_FILE;
  const certificate = certificateFile
    ? parseCertificateFile(certificateFile)
    : undefined;

  const logLevelRaw =
    flags.logLevel ?? env.PEERKIT_LOG_LEVEL ?? DEFAULTS.logLevel;
  if (!(LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
    throw new CliError(
      `--log-level "${logLevelRaw}" is not valid; allowed: ${LOG_LEVELS.join(", ")}`,
    );
  }
  const logLevel = logLevelRaw as LogLevel;

  return {
    id: flags.id ?? env.PEERKIT_RELAY_ID ?? DEFAULTS.id,
    listenAddrs,
    networkSecret: computeNetworkAccessBytes(networkSecret),
    publicHost: flags.publicHost ?? env.PEERKIT_PUBLIC_HOST,
    certificate,
    logLevel,
    otel,
  };
}
