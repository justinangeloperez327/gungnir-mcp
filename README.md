# Gungnir MCP Server

[![CI](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/justinangeloperez327/gungnir-mcp/actions/workflows/ci.yml)

A Model Context Protocol (MCP) server for the [Gungnir](https://github.com/justinangeloperez327/gungnir) C++23 web framework and its `.gnr` language.

**Developer preview: Group 8, version 0.8.0.** Local stdio server supporting modern and legacy MCP protocols, trusted project configuration, native SDK discovery, structural project intelligence, and **native compiler validation via `gungnirc --check`** and **read-only C++ IR verification via `gungnirc --verify-ir`**. Application builds, C++ generation, migrations and file mutations remain unavailable.

## Requirements

- Node.js 24, npm, a compatible MCP stdio host.
- Install a trusted Gungnir SDK with `gungnirc` to use compiler validation. Project intelligence and status remain usable without it.
- Configure an explicit trusted project root for source validation.

## Setup

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run pack:check
```

Run the compiled server from your MCP host with an explicitly trusted project, for example:

```sh
node dist/index.js --project-root "/work/inventory" --trusted-root "/work"
```

An MCP stdio server waits for client messages and reserves stdout for protocol traffic. Use `npx @modelcontextprotocol/inspector node dist/index.js` to inspect a server started without project access.

## Available MCP tools

| Tool | Function |
| --- | --- |
| `gungnir_status` | Server version, group, capabilities, trust state |
| `gungnir_toolchain_info` | Read-only Gungnir CLI, compiler, SDK and CMake discovery |
| `gungnir_project_info` | Trusted Gungnir project marker/profile, structure and counts |
| `gungnir_list_modules` | Bounded relative `.gnr` module listing |
| `gungnir_check` | Native structured project or single-file `--check` validation with structured diagnostic results |
| `gungnir_verify_ir` | Structured-project or indexed-source C++ IR verification; returns metadata and redacted verifier results |

Calling `gungnir_check` with `{}` validates an explicitly trusted **structured** project. With `{"file":"app/models/User.gnr"}`, it checks one indexed, project-relative file, using compatibility mode when the project is legacy. Compiler errors return codes, locations and sanitized messages, not raw source excerpts or absolute paths.

Only fixed `gungnirc --check` and `gungnirc --verify-ir` operations are permitted. No caller-supplied compiler flags, executable paths, output targets or working directories are accepted.

## SDK selection and security

Select the trusted SDK using `GUNGNIR_MCP_SDK_ROOT`, or `GUNGNIR_CMAKE_PREFIX`, otherwise use a trusted absolute `PATH`. Explicit SDK overrides do not silently fall back to another compiler. Native version and check operations run through the bounded, no-shell subprocess runner.

**Important:** Native compilation checks necessarily read trusted source files and execute a local `gungnirc` binary. Only enable them for projects and toolchains you trust. Canonical filesystem checks and bounded scans are not a race-free OS sandbox.

Read [IR verification](docs/ir-verification.md), [Compiler validation](docs/compiler-validation.md), [Process runner](docs/process-runner.md), [Project intelligence](docs/project-intelligence.md), [Configuration](docs/configuration.md), [Security](docs/security.md) and the [16-group roadmap](docs/roadmap.md).

CI uses Node.js 24 on Windows 2025 and Ubuntu 24.04. **No automatic npm publication or deployment.** MIT license.
