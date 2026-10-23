import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { installSignalShutdown, reportProtocolError } from "../src/lifecycle.js";

class FakeSignalHost extends EventEmitter {
  exitCode: number | undefined;
}

describe("stdio lifecycle", () => {
  it("closes exactly once under repeated shutdown and simultaneous signals", async () => {
    const host = new FakeSignalHost();
    const close = vi.fn(async () => undefined);
    const lifecycle = installSignalShutdown({ close }, host);

    host.emit("SIGINT");
    host.emit("SIGTERM");
    await lifecycle.shutdown();
    await lifecycle.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect(host.listenerCount("SIGINT")).toBe(0);
    expect(host.listenerCount("SIGTERM")).toBe(0);
    expect(host.exitCode).toBeUndefined();
  });

  it("reports shutdown failures and sets a failing exit code", async () => {
    const host = new FakeSignalHost();
    const report = vi.fn();
    const failure = new Error("close failed");
    const lifecycle = installSignalShutdown({
      close: async () => { throw failure; }
    }, host, report);

    await lifecycle.shutdown();
    expect(host.exitCode).toBe(1);
    expect(report).toHaveBeenCalledWith(failure);
    expect(host.listenerCount("SIGINT")).toBe(0);
  });

  it("writes transport errors only to stderr", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      reportProtocolError(new Error("protocol failure"));
      expect(stderr).toHaveBeenCalledWith("gungnir-mcp: protocol failure\n");
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });
});
