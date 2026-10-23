# Architecture — Group 2

```text
MCP client (legacy initialize / modern discover)
                   |
              stdio JSON-RPC
                   |
          serveStdio(createServer)
                   |
      one McpServer per connection
                   |
       gungnir_status (read-only)

Later: project discovery / CLI / compiler / docs.
```

## Protocol and lifecycle responsibilities

- Official `@modelcontextprotocol/server` v2 `serveStdio` owns wire framing, era selection and the pinned `McpServer` instance.
- The server opts into `legacy: "serve"` so both 2025 and 2026 opening methods are accepted.
- No reimplementation of JSON-RPC framing or `.gnr` grammar in TypeScript.
- The SDK owns connection teardown on client EOF. The entry point registers SIGINT and SIGTERM handlers to close the server idempotently through its handle.
- Signal shutdown is asynchronous and does not unconditionally call `process.exit()`.
- Protocol errors are handled in-band by the SDK; out-of-band errors are reported to stderr only.
- A new MCP server instance is created per process connection. The stdio process does not offer remote network access.

## Compatibility

Tests exercise the compiled executable from the official `@modelcontextprotocol/client` v2 `StdioClientTransport` with both its `legacy` initialization and pinned `2026-07-28` discovery. EOF and recovery from unknown tool requests are also tested. This does not claim compatibility with every existing MCP host.

## Group boundary

Toolchain discovery, sandboxing, subprocess invocation, `.gnr` compiler checks, generator writes and builds are deferred to Groups 3–15. See [roadmap](roadmap.md) and [protocol troubleshooting](protocol.md).
