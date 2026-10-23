# Architecture — Group 4

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
