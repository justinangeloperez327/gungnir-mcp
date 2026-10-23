# Security policy and project boundaries

## Implemented through Group 5

- Local stdio transport only. No HTTP listener or arbitrary shell.
- Zod-validated startup project configuration; current directory not implicitly trusted.
- Existing canonical project-root allowlist and project-path symlink checks from Group 3.
- New read-only `gungnir_toolchain_info` tool accepts no path, command or executable arguments from the MCP client.
- Native discovery selects only `gungnir`, `gungnirc`, and `cmake` as regular files, skips empty/relative PATH entries and never executes `.cmd` or `.bat` wrappers.
- Executable inspection uses fixed `--version` args via the Group 5 `spawn` runner without a shell or stdin, with a timeout (max 10 seconds), combined output cap (max 64 KiB), environment allowlist and temporary working directory.
- A caller cannot select command-line arguments, a project working directory, arbitrary environment variables or arbitrary executables. Cancellation is supported with AbortSignal.
- Failed native executions return redacted error codes, not arbitrary child output.
- SDK profile and adapters come from the installed, size-limited `share/gungnir/sdk.txt` manifest; no inferred capabilities.
- No paths or raw subprocess errors are returned to MCP clients. Error messages are generic.
- No compiler checks, application builds, file writes, migrations or database calls.
- CI does not publish or deploy.

## Trust caveats

Reading binary version output requires *executing the binary's version handler*. A compromised or malicious executable on PATH or in an operator-specified SDK can perform side effects beyond the MCP server's control. Install trusted SDKs and keep PATH entries trusted. The MCP server is not an OS sandbox.

Canonical filesystem checks alone are not race-free if a project mutates symlinks concurrently. Before enabling native application operations, future groups must add project-specific command validation, race-resistant file access, separate permission gates for writes/builds, and stronger Windows subprocess-tree termination before allowing long-running application commands.

Report vulnerabilities privately through GitHub's vulnerability reporting feature when enabled.
