# Gungnir MCP Server

[![CI](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml)

**Gungnir MCP Server** integrates the [Gungnir](https://github.com/justinangeloperez327/gungnir) C++23 framework and `.gnr` language with MCP hosts.

> **Group 3 / developer preview (0.3.0).** Local stdio server supporting legacy and modern MCP, validated configuration and fail-closed project trust. Only `gungnir_status` is exposed; native compiler, build and code generation are not yet available.

## Requirements

- Node.js **24** with npm
- An MCP client supporting local stdio
- Gungnir SDK is not required until later groups

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run pack:check
```

Launch with `node dist/index.js`, or use `npx @modelcontextprotocol/inspector node dist/index.js`.

## Optional explicit project trust

No working directory is trusted implicitly. You can configure a project and its trusted parent directory for future capabilities:

```bash
node dist/index.js --project-root "/home/dev/inventory" --trusted-root "/home/dev"
```

Alternatively use the environment variables `GUNGNIR_MCP_PROJECT_ROOT` and `GUNGNIR_MCP_TRUSTED_ROOTS`. Repeat `--trusted-root` for additional allowlist entries. Environment trusted-root entries use the platform's path delimiter (`:` on Linux, `;` on Windows). CLI trust flags replace environment trust roots.

Missing/invalid trust causes startup failure on stderr. The current status tool reports `projectAccess: "disabled" | "trusted"` without revealing any root path. Trust **does not** enable native execution or mutations.

See [Configuration](docs/configuration.md), [Security](docs/security.md), [Architecture](docs/architecture.md), [Setup](docs/setup.md), [Protocol](docs/protocol.md), and [Roadmap](docs/roadmap.md).

CI verifies Node 24 builds and tests on Ubuntu 24.04 and Windows 2025. No automatic npm publishing or deployment.

MIT License.
