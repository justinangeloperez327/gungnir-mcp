# Gungnir MCP Server

[![CI](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml)

**Gungnir MCP Server** provides a Model Context Protocol (MCP) integration for the [Gungnir](https://github.com/justinangeloperez327/gungnir) C++23 web framework and its `.gnr` language.

> **Status: Group 2 protocol foundation / developer preview (0.2.0).** Includes read-only `gungnir_status`, a real stdio server with clean shutdown, and client integration tests for both legacy and modern MCP protocol eras. Native toolchain discovery, source validation, code generation, and builds remain planned.

## Requirements

- Node.js **24** and npm.
- A compatible MCP host for stdio connections.
- A Gungnir SDK is **not required** for Groups 1–2.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run pack:check
```

The compiled entry point `node dist/index.js` is an MCP server, not an interactive terminal application. Its stdout is reserved for protocol frames. To exercise it, connect an MCP client or run:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

`npm run dev` starts the TypeScript entry point under `tsx`.

## Current MCP API

- Tool: `gungnir_status` (read-only), returning server identity, group and available capabilities.
- Transport: stdio only.
- Protocol: MCP SDK v2's legacy 2025 initialization and modern 2026-07-28 discovery, with automatic era selection on inbound stdio messages.
- Lifecycle: EOF closes the connection; SIGINT and SIGTERM request idempotent graceful teardown.
- Errors: SDK JSON-RPC errors stay in-band, transport diagnostics go to stderr.

No native project commands or filesystem writes are currently exposed.

## Documentation

[Architecture](docs/architecture.md) · [Setup](docs/setup.md) · [Protocol and troubleshooting](docs/protocol.md) · [Security](docs/security.md) · [Roadmap](docs/roadmap.md)

## Delivery policy

GitHub Actions validates Node.js 24 on Ubuntu and Windows and stores build artifacts. No npm publication or deployment takes place.

## License

MIT. See [LICENSE](LICENSE).
