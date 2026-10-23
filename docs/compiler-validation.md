# Native compiler validation — Group 7

The new `gungnir_check` MCP tool provides native compiler **validation only**, using `gungnirc --check` and returning normalized results. It does **not** emit C++, build applications, run Gungnir, migrate a database or write project files.

## Input contract

```json
{}
```

With no `file`, check the entire trusted structured project. Internally the runner passes exactly:

```
gungnirc --project <canonical-project-root> --check
```

Or:

```json
{"file":"app/models/User.gnr"}
```

For a single, indexed project-relative `.gnr` source file, the runner passes exactly:

```
gungnirc <canonical-file-path> --check
```

When the project marker indicates legacy/compatibility, single-file checks additionally pass `--compat`. Whole-project `--project` checking is intentionally limited to structured projects because compatibility `gungnirc --project` is not supported.

The tool has no `command`, `flags`, `output`, `cwd`, `executable` or arbitrary path argument.

## Trust and refusal conditions

- Operator must configure `--project-root` and `--trusted-root` (or equivalent environment settings). The project directory is never inferred from cwd.
- Project must pass the Group 6 bounded module scan. Truncated scans, symlinks/junctions, unsafe/unreadable paths and invalid project markers prevent compiler invocation.
- File names must match a safe, indexed `.gnr` module path exactly. Path traversal, absolute paths, Windows separators/drive paths, embedded NUL and unknown modules are refused.
- Compiler is selected from an explicit trusted `GUNGNIR_MCP_SDK_ROOT` or `GUNGNIR_CMAKE_PREFIX`, or a trusted executable found on `PATH`. An invalid override never falls back to PATH.
- The subprocess runner revalidates canonical executable paths and project/file containment before spawning.
- Native checks run without a shell or stdin, in a temporary working directory with an isolated environment. The default check timeout is 10 seconds (max 30 seconds). Default combined output cap is 32 KiB (max 64 KiB); AbortSignal cancellation is supported internally.

These checks do not constitute an OS sandbox. A malicious compiler executable, concurrency-induced filesystem changes, or imports within a trusted project can still access data. Never use this tool on untrusted project contents or executable locations.

## Response structure

`gungnir_check` responds with `state`, `target`, `file`, `exitCode`, `reason`, `diagnostics` and `diagnosticsTruncated`.

States include `valid`, `invalid`, `blocked`, `unavailable`, `timeout`, `cancelled`, `output_limit`, and `failed`. A missing compiler is `unavailable`. Untrusted or unsafe project/file inputs are `blocked`.

Diagnostics are normalized from the Gungnir renderer's header lines (`file:line:column: severity[GNRcode]: message`) and capped at 40. The response exposes only indexed **relative** file paths, numeric positions, severity, GNR code and sanitized, length-limited messages. Source lines, caret excerpts, help lines, unknown absolute paths and raw subprocess failures are not returned. Missing/unknown diagnostic format results in a stable failure state and possibly an empty diagnostics array.

An illustrative compiler-error response:

```json
{
  "state": "invalid",
  "target": "file",
  "file": "app/models/User.gnr",
  "exitCode": 1,
  "reason": "compiler_rejected_source",
  "diagnostics": [
    { "file": "app/models/User.gnr", "line": 4, "column": 9,
      "severity": "error", "code": "GNR1324", "message": "unknown reference [value]" }
  ],
  "diagnosticsTruncated": false
}
```

The tool marks nonvalid states with `isError: true` in the MCP response while retaining its structured text content. This is expected for a compiler error, and should not be confused with an MCP transport failure.

## Validation evidence and scope

CI tests the compiler service with injected, deterministic native-runner results; it also exercises `gungnir_check` over real legacy and modern MCP stdio connections, including untrusted roots and path traversal. The existing runner/security suites cover timeouts, output limits and cancellation. Neither CI platform requires a production-installed Gungnir SDK; validating native `.gnr` semantics against actual release binaries requires a separate SDK integration test in a later group.
