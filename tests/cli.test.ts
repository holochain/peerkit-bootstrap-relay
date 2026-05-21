import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, parseCli } from "../src/cli.js";
import { computeNetworkAccessBytes } from "../src/network-access.js";

const baseEnv = { PEERKIT_NETWORK_SECRET: "s" } as NodeJS.ProcessEnv;

describe("parseCli", () => {
  it("loads defaults when only secret provided", () => {
    const cfg = parseCli([], baseEnv);
    expect(cfg.id).toBe("peerkit-bootstrap-relay");
    expect(cfg.listenAddrs).toEqual([
      "/ip4/0.0.0.0/tcp/4001",
      "/ip6/::/tcp/4001",
    ]);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.otel).toBeUndefined();
    expect(cfg.publicHost).toBeUndefined();
    expect(cfg.networkSecret).toEqual(computeNetworkAccessBytes("s"));
  });

  it("CLI flag overrides env", () => {
    const cfg = parseCli(["--id", "from-cli"], {
      ...baseEnv,
      PEERKIT_RELAY_ID: "from-env",
    });
    expect(cfg.id).toBe("from-cli");
  });

  it("env overrides default when CLI absent", () => {
    const cfg = parseCli([], { ...baseEnv, PEERKIT_RELAY_ID: "from-env" });
    expect(cfg.id).toBe("from-env");
  });

  it("repeats --listen-addr to build the list", () => {
    const cfg = parseCli(
      [
        "--listen-addr",
        "/ip4/0.0.0.0/tcp/5000",
        "--listen-addr",
        "/ip6/::/tcp/5000",
      ],
      baseEnv,
    );
    expect(cfg.listenAddrs).toEqual([
      "/ip4/0.0.0.0/tcp/5000",
      "/ip6/::/tcp/5000",
    ]);
  });

  it("splits comma-separated PEERKIT_RELAY_LISTEN_ADDRS", () => {
    const cfg = parseCli([], {
      ...baseEnv,
      PEERKIT_RELAY_LISTEN_ADDRS: "/ip4/0.0.0.0/tcp/1, /ip4/0.0.0.0/tcp/2",
    });
    expect(cfg.listenAddrs).toEqual([
      "/ip4/0.0.0.0/tcp/1",
      "/ip4/0.0.0.0/tcp/2",
    ]);
  });

  it("reads --public-host", () => {
    const cfg = parseCli(["--public-host", "relay.example.com"], baseEnv);
    expect(cfg.publicHost).toBe("relay.example.com");
  });

  it("reads PEERKIT_PUBLIC_HOST", () => {
    const cfg = parseCli([], {
      ...baseEnv,
      PEERKIT_PUBLIC_HOST: "relay.example.com",
    });
    expect(cfg.publicHost).toBe("relay.example.com");
  });

  it("missing network secret throws CliError", () => {
    expect(() => parseCli([], {})).toThrowError(/PEERKIT_NETWORK_SECRET/);
  });

  it("invalid listen-addr port throws CliError", () => {
    expect(() =>
      parseCli(["--listen-addr", "/ip4/0.0.0.0/tcp/0"], baseEnv),
    ).toThrowError(/listen-addr\[0\]/);
    expect(() =>
      parseCli(["--listen-addr", "/ip4/0.0.0.0/tcp/65536"], baseEnv),
    ).toThrowError(/listen-addr\[0\]/);
  });

  it("enables OTel when endpoint provided", () => {
    const cfg = parseCli(
      ["--otel-otlp-endpoint", "http://otel:4318/v1/metrics"],
      baseEnv,
    );
    expect(cfg.otel).toEqual({
      otlpEndpoint: "http://otel:4318/v1/metrics",
      exportIntervalMs: 60_000,
      headers: undefined,
    });
  });

  it("parses --otel-headers k=v,k=v", () => {
    const cfg = parseCli(
      [
        "--otel-otlp-endpoint",
        "http://otel:4318/v1/metrics",
        "--otel-headers",
        "x-api-key=k,tenant=t1",
      ],
      baseEnv,
    );
    expect(cfg.otel?.headers).toEqual({
      "x-api-key": "k",
      tenant: "t1",
    });
  });

  it("rejects malformed --otel-headers entry", () => {
    expect(() =>
      parseCli(
        [
          "--otel-otlp-endpoint",
          "http://otel:4318/v1/metrics",
          "--otel-headers",
          "no-equals-sign",
        ],
        baseEnv,
      ),
    ).toThrowError(/otel-headers entry/);
  });

  it("rejects non-integer --otel-export-interval-ms", () => {
    expect(() =>
      parseCli(
        [
          "--otel-otlp-endpoint",
          "http://otel:4318/v1/metrics",
          "--otel-export-interval-ms",
          "0",
        ],
        baseEnv,
      ),
    ).toThrowError(/otel-export-interval-ms/);
  });

  it("invalid --log-level throws CliError", () => {
    expect(() => parseCli(["--log-level", "verbose"], baseEnv)).toThrowError(
      CliError,
    );
    expect(() => parseCli(["--log-level", "verbose"], baseEnv)).toThrowError(
      /trace, debug, info, warn, error/,
    );
  });

  it("invalid --listen-addr throws CliError", () => {
    expect(() =>
      parseCli(["--listen-addr", "/not/a/multiaddr"], baseEnv),
    ).toThrowError(CliError);
    expect(() =>
      parseCli(["--listen-addr", "/not/a/multiaddr"], baseEnv),
    ).toThrowError(/listen-addr\[0\]/);
  });

  describe("--help", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("prints usage and exits 0", () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((_code?: string | number | null | undefined) => {
          throw new Error("process.exit called");
        });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(() => parseCli(["--help"], baseEnv)).toThrow(
        "process.exit called",
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Usage: peerkit-relay"),
      );
    });
  });

  describe("--version", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("prints the version and exits 0", () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((_code?: string | number | null | undefined) => {
          throw new Error("process.exit called");
        });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(() => parseCli(["--version"], baseEnv)).toThrow(
        "process.exit called",
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\d+\.\d+\.\d+$/),
      );
    });
  });
});
