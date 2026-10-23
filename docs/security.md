# Security policy and project boundaries

## Implemented in Group 1

- Local stdio transport only; no open network port.
- Only `gungnir_status`, with no input and no filesystem or subprocess operations.
- Stdout is reserved for MCP protocol traffic.
- No project write, native build, migration, shell command, credential or database access.
- GitHub Actions do not deploy or publish npm packages.

## Planned controls before mutating tools

- Explicit project-root trust and canonical-path containment.
- Allowlisted Gungnir CLI commands and typed arguments; no shell execution.
- Controlled environment variables, timeouts, output limits and cancellation.
- Write permissions and preview for generators and formatting.
- Secret redaction and safe diagnostic output.
- Distinct security review for executing native builds.

Report security issues through GitHub's private vulnerability reporting feature where enabled; otherwise contact the repository maintainer privately rather than disclosing exploitable details in a public issue.
