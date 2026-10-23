import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface CloseHandle {
  close(): Promise<void>;
}

/** Subset of process needed to install platform-neutral signal handlers. */
export interface SignalHost {
  once(signal: ShutdownSignal, listener: () => void): void;
  off(signal: ShutdownSignal, listener: () => void): void;
  exitCode?: number | undefined;
}

export function reportProtocolError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unexpected MCP transport error";
  // NEVER log on stdout; the channel carries only JSON-RPC frames.
  process.stderr.write(`gungnir-mcp: ${message}\n`);
}

/**
 * Idempotent signal shutdown; SDK owns EOF teardown for disconnected clients.
 * Does not call process.exit(): allow protocol streams to close naturally.
 */
export function installSignalShutdown(
  handle: CloseHandle,
  host: SignalHost = process,
  reportError: (error: unknown) => void = reportProtocolError
): { shutdown: () => Promise<void> } {
  let closing: Promise<void> | undefined;
  const onSignal = (): void => { void shutdown(); };
  const detach = (): void => {
    host.off("SIGINT", onSignal);
    host.off("SIGTERM", onSignal);
  };
  const shutdown = (): Promise<void> => {
    if (!closing) {
      closing = Promise.resolve()
        .then(() => handle.close())
        .catch((error: unknown) => {
          host.exitCode = 1;
          reportError(error);
        })
        .finally(detach);
    }
    return closing;
  };

  host.once("SIGINT", onSignal);
  host.once("SIGTERM", onSignal);
  return { shutdown };
}

/**
 * The MCP v2 serveStdio adapter pins one server per connection and
 * selects modern discovery vs. legacy initialization from the first message.
 */
export function startStdioServer(): void {
  const handle = serveStdio(createServer, {
    legacy: "serve",
    onerror: reportProtocolError
  });
  installSignalShutdown(handle);
}
