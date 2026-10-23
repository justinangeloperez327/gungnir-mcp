# Security policy and project boundaries

## Implemented through Group 3

- Local stdio transport only; no HTTP listener or arbitrary shell.
- Zod v4 validates startup configuration; the current directory is never implicitly trusted.
- An explicitly configured project requires explicitly configured trusted roots (max 16). Roots must be existing absolute directories.
- Canonical `realpath`-based project containment blocks directory-prefix and symlink-root escapes.
- Existing path resolution rejects traversal, absolute/drive/UNC/ADS-style paths, missing targets and symlink/junction escapes.
- Trust originates only from operator-provided startup flags and environment settings, never MCP tool-call arguments.
- The sole read-only `gungnir_status` tool reports trust state, not paths, files or secrets.
- Protocol errors stay in-band; diagnostics are emitted to stderr, never stdout.
- No file writes, native builds, migrations, shell commands, credentials or database access.
- CI stores artifacts only; it does not deploy or publish.

## Remaining controls

`realpath` is not a race-free guarantee if files or symlinks are concurrently changed. Before enabling native Gungnir execution or mutation, implement per-command argument allowlists, scoped file handles or equivalent stronger containment, controlled environments, timeouts, output limits and explicit write/execute approval. Do not expose an unrestricted process runner.

Report vulnerabilities privately using GitHub vulnerability reporting where enabled.
