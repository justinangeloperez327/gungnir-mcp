# Architecture — Groups 4–7

```text
MCP client
  |
  +-- stdio transport / modern + legacy MCP
  |
  +-- validated startup project trust (optional)
  |
  +-- gungnir_status (no native probing)
  |
  +-- gungnir_toolchain_info (on demand, no input)
       |
       +-- validated SDK root override or absolute PATH lookup
       +-- CLI / compiler / CMake, fixed --version probes
       +-- share/gungnir/sdk.txt (SDK profile + adapters)
       +-- structured results + redacted diagnostics
```

No Gungnir application code is loaded, compiled or executed. The toolchain probe has no dependency on an explicitly trusted project directory. Paths and raw CLI output remain private; only profile, version, enabled capabilities and generic diagnostics reach the MCP client.

The existing `serveStdio` MCP SDK v2 adapter supports both protocol eras, EOF handling and graceful signal shutdown. See [Toolchain discovery](toolchain.md), [Configuration](configuration.md), [Security](security.md) and [Roadmap](roadmap.md).

## Group 5 subprocess boundary

`gungnir_toolchain_info` now routes fixed version commands through `runAllowedNative`. The internal runner canonicalizes executable paths, rejects non-native or mismatched executable basenames, and runs native binaries through `spawn` with a fixed `--version` argument, disabled shell/stdin, temporary working directory, restricted environment, and bounded time/output. The subprocess result is converted by toolchain discovery into version metadata or generic errors; paths and raw failure text are never included in the MCP response.

This is **not** a capability to compile or execute project code. No new MCP tool accepts process arguments. [Process runner](process-runner.md) documents the constraints.

## Group 6 project intelligence

The two new project tools share a single internal, read-only `scanProject` implementation. It rechecks the canonical configured root and trusted-root containment before traversal. The scanner reads only the bounded `.gungnir-project` marker; it never reads the contents of any `.gnr` file, environment file, native source file, or other project configuration. Module names derive from **sanitized relative paths**, not parsing source code.

The scanner does not follow symlinks/junctions, skips generated/hidden/sensitive paths, bounds entry count/depth/module count, and reports incomplete results through `truncated` and diagnostic codes. No arbitrary user path is accepted. Project intelligence performs only structural checks; it does **not** claim syntax/semantic validation.

See [Project intelligence](project-intelligence.md) for API examples and limitations.

## Group 7 read-only compiler validation

A caller invokes `gungnir_check` with `{}` for a structured project or `{ "file": "app/models/User.gnr" }` for a safe indexed source file. Before invoking the native binary, the compiler-check service rechecks configured trust and the bounded project scanner, rejects symlinks and incomplete scans, and locates `gungnirc` through the strict SDK selection precedence. It passes only typed check operations through the shared restricted process runner. Compiler diagnostic headers are normalized to code/severity/relative path/position and sanitized message; raw output is not returned. No build, generation or mutation API exists. See [Compiler validation](compiler-validation.md).

## Group 8 C++ IR verification

`gungnir_verify_ir` reuses the Group 7 trusted project scan, compiler discovery, executable validation and bounded subprocess controls, but invokes dedicated fixed IR operations (`verify_ir_project` or `verify_ir_file`) instead of `--check`. IR verification is available only for structured profiles: legacy `--compat` is deliberately rejected because the native compiler disallows it with `--verify-ir`. Both tools use the shared structured diagnostics parser; untrusted path references become `null`, messages are categorized rather than echoed, and native IR verifier issue lines are counted without exposing their contents. No generated IR/C++ is returned or written. See [IR verification](ir-verification.md).

## Group 9 MCP resources

`createServer()` registers immutable, exact URI resources via MCP SDK v2 `registerResource`. A pinned official Gungnir `v1.0.2` snapshot (`src/official-docs.ts`) is built directly into the packaged JavaScript, enabling offline doc reads with SHA-1 Git blob integrity checks. A fixed catalog exposes authoritative source commit and document URIs. The SDK capabilities resource is dynamic but reads only an operator-selected absolute SDK marker under `share/gungnir/sdk.txt`, with bounded file handles, symlink-escape checks and field allowlists. It **never** runs binaries or reveals SDK paths. No URI template or user-selected path is enabled. See [Documentation resources](documentation-resources.md).
