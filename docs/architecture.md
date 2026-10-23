# Architecture — Group 3

```text
MCP client -> stdio JSON-RPC -> CLI/env/Zod startup config
                                   |
                         canonical trusted roots
                                   |
                           serveStdio(server)
                                   |
                         gungnir_status (read-only)

Future: SDK discovery, guarded reads, compiler checks, generators, builds
```

SDK v2 handles legacy/modern MCP negotiation, framing, and client EOF; SIGINT/SIGTERM close the session idempotently.

Group 3 validates startup arguments, canonicalizes project/trusted roots with `realpath`, checks path-segment containment, and denies untrusted configurations before accepting MCP requests.

When no project is configured, the server continues in project-access-disabled mode. `gungnir_status` exposes the state but never the path. The current file resolution helper is for existing project paths only, not mutating or race-prone execution.

See [Configuration](configuration.md) and [Security](security.md).
