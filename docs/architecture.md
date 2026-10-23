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
