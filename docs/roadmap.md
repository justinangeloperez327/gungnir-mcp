# Finalized 16-group roadmap

1. **Foundation — complete** — Node.js 24, TypeScript, MCP SDK v2, Zod v4, strict lint, Vitest, esbuild, docs, CI.
2. **MCP Protocol — complete** — stdio lifecycle, legacy/modern compatibility, shutdown, EOF and real-client tests.
3. **Configuration & Trust — complete** — CLI/env settings, trusted roots, canonical path containment and security tests.
4. **Native Toolchain Discovery — complete** — read-only discovery of CLI, compiler, installed SDK profile/adapters, version mismatches and CMake with platform tests.
5. **Secure Process Runner — complete** — fixed version-command allowlists, validated executables, cancellation, timeouts, bounded output and environment isolation. No build/run/write operations.
6. **Project Intelligence — complete** — trusted read-only structured/legacy profile inspection, bounded module listing, structural diagnostics and sensitive-path exclusions.
7. **Compiler Validation — complete** — trusted structured-project and indexed-file \`gungnirc --check\`, safe process controls, normalized error metadata, cross-platform MCP tests.
8. **IR & Diagnostics — complete** — trusted `--verify-ir` for structured project/files, privacy-safe diagnostic categories, verifier issue counting and cross-platform MCP security regression tests.
9. **Documentation Resources — complete** — 16 exact, tagged official Gungnir docs, fixed MCP resource URIs and catalog, bounded hash-validated reads, and sanitized local SDK capabilities.
10. **Documentation Search — next** — versioned offline index.
11. **MCP Prompts** — scaffolding, debugging and review.
12. **Generation Planning** — safe previews and dependency detection.
13. **Code Generation** — permission-gated generators.
14. **Source Formatting** — check, preview and apply.
15. **Build & Client Integration** — native builds, clients and packaging.
16. **Final Audit & Release** — end-to-end tests, security, manual release.

No remote MCP service, arbitrary shell execution, database mutation, automatic deployment or npm publication is authorized.
