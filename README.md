# Gungnir MCP Server

[![CI](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml)

**Gungnir MCP Server** integrates the [Gungnir](https://github.com/justinangeloperez327/gungnir) C++23 framework and `.gnr` language with MCP hosts.

> **Group 6 / developer preview (0.6.0).** Includes local stdio MCP (legacy and modern protocols), validated trusted project roots, **read-only native toolchain discovery**, and a bounded, allowlisted native process runner, and **read-only trusted project intelligence**. Compiler checking, project builds and code generation are **not yet available**.

## Requirements

- Node.js **24** and npm
- An MCP host supporting stdio
- Gungnir SDK and CMake are optional for starting the MCP server; discovery reports missing installations

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run pack:check
```

To connect via MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

The process uses stdout exclusively for JSON-RPC messages. Do not run it as an interactive shell program.

## Tools

- `gungnir_status`: the protocol/server version, group, capabilities and whether a project was explicitly trusted. It does not probe native tools.
- `gungnir_toolchain_info`: an on-demand, no-argument, **read-only discovery** operation. It locates `gungnir`, `gungnirc`, `cmake`, reads `share/gungnir/sdk.txt`, and issues **only** fixed `--version` commands. Returns versions, SDK profile, enabled adapters, compatibility status and redacted diagnostic messages, without absolute paths.

The discovery operation executes the installed binaries to obtain version banners. Only configure toolchains from sources you trust.

- `gungnir_project_info`: inspect the trusted project's `.gungnir-project` marker, structured/legacy profile, basic folder presence, sanitized name and categorized module counts. No source contents.
- `gungnir_list_modules`: enumerate up to 200 relative `.gnr` module paths with dotted module names and declaration-folder categories. No source contents.

Both project tools require an **explicitly configured trusted root**, use a bounded tree walk and exclude hidden, generated and sensitive directories; symlinks and junctions are not followed. See [Project intelligence](docs/project-intelligence.md). Without project trust, they return an MCP tool error.

## Secure subprocess boundary

Group 5 replaces direct CLI probing with an internal process runner. It only permits `gungnir --version`, `gungnirc --version`, and `cmake --version` against validated native executables. It rejects arbitrary commands, build/run/check operations, caller-supplied arguments, relative executables, and script wrappers. Internal callers may request bounded timeouts, output limits, or AbortSignal cancellation. The child runs with an isolated environment, no stdin, no shell, and no project working directory.

No general-purpose process tool has been added to MCP. **This is not an OS sandbox:** an executable selected from an untrusted PATH can still be malicious. See [Process runner](docs/process-runner.md) for the exact security boundary and limitations.

## Toolchain selection

Use `GUNGNIR_MCP_SDK_ROOT` to select an installed SDK directory explicitly. Otherwise an absolute `GUNGNIR_CMAKE_PREFIX` takes precedence, then the absolute directories listed in `PATH` are searched. An invalid explicit override **does not silently fall back** to another installation. `cmake` is resolved from `PATH` separately.

See [Toolchain discovery](docs/toolchain.md) for compatibility and security details.

## Optional project trust

No project directory is implicitly trusted. Explicit project access requires both `--project-root` and `--trusted-root` (or their environment counterparts); see [Configuration](docs/configuration.md). Trust does not grant build or write permissions.

## Documentation

[Toolchain discovery](docs/toolchain.md) · [Architecture](docs/architecture.md) · [Configuration](docs/configuration.md) · [Security](docs/security.md) · [Setup](docs/setup.md) · [Protocol](docs/protocol.md) · [Roadmap](docs/roadmap.md)

CI runs on Node.js 24 with Ubuntu 24.04 and Windows 2025 and uploads build artifacts. It does **not** publish an npm package or deploy services. MIT License.
