# Security policy and project boundaries

## Implemented through Group 2

- Local stdio transport only; no open network port.
- Only `gungnir_status`, which has no arguments or filesystem/subprocess operations.
- Modern and legacy protocol handling is delegated to the official MCP v2 SDK.
- SDK protocol errors travel in-band; out-of-band reporting goes only to stderr.
- SIGINT/SIGTERM close the server handle idempotently; EOF is handled by the SDK.
- No project write, native build, migration, shell command, credential or database access.
- CI does not deploy or publish npm packages.

## Planned controls before mutating tools

- Explicit project-root trust and canonical-path containment.
- Allowlisted Gungnir CLI commands and typed arguments; no arbitrary shell execution.
- Controlled environment variables, timeouts, output limits and cancellation.
- Write permissions and preview for generators and formatting.
- Secret redaction and safe diagnostic output.
- Distinct security review for executing native builds.

Report security issues privately via GitHub vulnerability reporting where available.
