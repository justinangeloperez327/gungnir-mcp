# Gungnir native toolchain discovery — Group 4

The MCP tool `gungnir_toolchain_info` is on-demand and requires **no arguments**. It does not compile or run a Gungnir project.

## Discovery order

1. `GUNGNIR_MCP_SDK_ROOT` — exact absolute SDK root (highest priority, strict override)
2. `GUNGNIR_CMAKE_PREFIX` — absolute SDK root when the above is not set
3. `PATH` — search absolute entries for `gungnir` and `gungnirc` (or `.exe` on Windows)

When an SDK override is specified, the server checks only `<root>/bin/gungnir` and `<root>/bin/gungnirc`; it never falls back to PATH for those two tools. The CMake executable is discovered separately on `PATH`.

Relative and empty PATH entries are ignored; `.bat` and `.cmd` wrappers are not executed. All selected executable files are canonicalized with `realpath` and must be regular files (and executable on POSIX).

## Version checks

Exactly three binary names are supported: `gungnir`, `gungnirc`, and `cmake`. Discovery invokes each binary only with `--version`, without a shell, using a temporary working directory, a three-second default timeout, restricted environment variables, an 8 KiB default combined-output limit, and hidden Windows windows. It now uses the audited Group 5 `runAllowedNative` runner ([details](process-runner.md)) with cancellation support; no project execution options are exposed.

Expected compatibility:
- Gungnir CLI / compiler / SDK: major version **1**, and versions must match
- CMake: **3.25 or newer**
- SDK: valid `share/gungnir/sdk.txt`, including `profile` and `package_version`
- CLI/compiler discovered via PATH must come from the same canonical `bin` directory to associate an SDK marker

Unknown, missing, invalid, and incompatible tools are reported as such. Results may be `missing` on GitHub Actions runners without the native Gungnir SDK; this is a valid discovery result, not a failed MCP protocol session.

## SDK metadata

Reads the installed Gungnir manifest `share/gungnir/sdk.txt` (at most 16 KiB). Recognizes `core`, `application`, and `custom` profiles; detects listed capability flags such as SQLite, password hashing, PostgreSQL, MySQL, SQL Server, MongoDB, Redis, SMTP, TLS, HTTP/2, and S3. A missing or malformed manifest is an error; capabilities are not guessed.

Gungnir 1.0.2 documents both core and application SDKs. The application SDK includes SQLite and password hashing; other adapters require an appropriate custom SDK.

## Safe operational limits

This operation **does execute external binaries' version entry points**, which could run malicious code if an untrusted executable is earlier on PATH or selected as the SDK root. Operators must trust their installed SDK and PATH entries. It is not a sandbox and does not confer permission for builds, code generation, migrations or arbitrary shell commands.

The MCP report does not disclose absolute local paths or raw executable output. Errors returned by subprocesses are converted to generic diagnostics; version probes do not inherit application secrets from the environment.

## Example

PowerShell, after installing Gungnir:

```powershell
$env:GUNGNIR_MCP_SDK_ROOT = "C:\SDKs\Gungnir-application"
node dist/index.js
```

The MCP host can call `gungnir_toolchain_info` after establishing its stdio session. A project root is *not* required for toolchain discovery. Project trust remains governed independently by `--project-root` and `--trusted-root`.
