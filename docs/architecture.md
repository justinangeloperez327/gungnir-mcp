# Architecture — Group 1

```text
MCP host <-> stdio <-> gungnir-mcp (Node.js 24 / TypeScript)
                         |
                         +-- Group 1: read-only gungnir_status
                         +-- Future: Gungnir CLI, compiler, docs and prompts
```

## Boundaries

- The MCP SDK implements the protocol; Gungnir remains the source of truth for `.gnr` grammar, diagnostics and native builds.
- The server is independent of `gungnir` and `vscode-gungnir`, with future integration through documented CLI and LSP interfaces.
- Group 1 does **not** execute native commands, modify files, serve HTTP, read secrets or implement any network API.
- A new `McpServer` is created per stdio session using the official v2 `serveStdio` helper.
- Diagnostics, project roots and subprocess security will be designed before introducing native operations.

## Version policy

Framework compatibility will be tested against Gungnir 1.0.x. MCP server versioning is independent of the framework release. The source code imports `@modelcontextprotocol/server` v2 and Zod v4; the old v1 `@modelcontextprotocol/sdk` package must not be introduced.

See [Roadmap](roadmap.md).
