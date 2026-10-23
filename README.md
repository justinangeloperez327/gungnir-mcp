# Gungnir MCP Server

[![CI](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml)

**Gungnir MCP Server** provides a Model Context Protocol (MCP) integration for the [Gungnir](https://github.com/justinangeloperez327/gungnir) C++23 web framework and its `.gnr` language.

> **Status: Group 1 foundation / developer preview (0.1.0).** This version includes only a safe, read-only `gungnir_status` tool. Project inspection, native Gungnir CLI execution, code generation, and builds are planned for later groups. Do not assume those capabilities are available yet.

## Requirements

- Node.js **24** and npm (Node 24-native GitHub Actions).
- A compatible MCP host for stdio-based MCP integration.
- The Gungnir CLI and SDK are **not required** for Group 1; later tools will require them.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
node dist/index.js
```

The compiled entry point speaks MCP over standard input/output; it is not an interactive terminal program. It intentionally writes **no logs to stdout**. Use an MCP client or Inspector to exercise it. For local development, `npm run dev` runs the TypeScript entry point using `tsx`.

To verify npm package contents:

```bash
npm run pack:check
```

## MCP API (Group 1)

- Tool `gungnir_status`: returns server identity, implementation group, and a truthful summary of current capabilities. It does not inspect files or execute commands.

## Configuration

The server currently uses **stdio only** and exposes no network listener. Read-only status is the only implemented capability. See [Architecture](docs/architecture.md), [Security](docs/security.md), [Setup](docs/setup.md) and [Roadmap](docs/roadmap.md).

## Development policy

- CI runs lint, type checking, bundling, tests, and package verification on Windows and Ubuntu.
- Node.js 24 is required; GitHub Actions run on their native Node 24 runtimes.
- Builds do not publish to npm or deploy to a service.
- Do not enable arbitrary shell execution or mutate Gungnir projects without a future explicit security design.

## License

MIT. See [LICENSE](LICENSE).
