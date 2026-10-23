# Read-only C++ IR verification — Group 8

The MCP tool `gungnir_verify_ir` invokes **only** Gungnir's native C++ intermediate-representation verifier in validation-only mode. It verifies structured Gungnir language modules without emitting IR, generated C++, application builds, or writing source files.

## Fixed requests and native command shapes

| MCP input | Allowed native operation |
| --- | --- |
| `{}` | `gungnirc --project <trusted-structured-project-root> --verify-ir` |
| `{"file":"app/models/User.gnr"}` | `gungnirc <trusted-indexed-structured-source> --verify-ir` |

The request schema is strict and accepts only an optional project-relative `.gnr` file. Arbitrary CLI options, executable paths, `--check`, `--compat`, `--format`, dump flags, `-o` output paths and shell commands are forbidden. The Gungnir source CLI explicitly prohibits `--verify-ir` with other validation/output modes and compatibility transpilation, so **legacy profiles are rejected for IR verification**, even for one file.

A failed or incomplete Group 6 project scan, untrusted root, symlink or junction, excluded sensitive path, relative-path traversal, unknown module, or missing native compiler yields a structured blocked/unavailable result. Compiler discovery honors strict SDK overrides; there is no fallback if an explicit SDK is invalid.

## Execution controls

The existing `runAllowedNative` runner uses shell-free `spawn`, fixed argument sequences, no stdin, an isolated environment, canonical executable validation, a temporary process working directory, a default 10-second timeout (maximum 30 seconds), default combined output limit 32 KiB (maximum 64 KiB), and internal AbortSignal cancellation.

`--verify-ir` compiles/validates Gungnir source in memory and lowers/verifies C++ IR within the compiler process. It is not a full native C++ application build. The native compiler can read imports and trusted project contents: executing a malicious compiler is never safe merely because only `--verify-ir` is allowed. File containment checks are not race-free against concurrent modifications.

## Structured result

The result uses the same `CheckReport` states as `gungnir_check`:

- `state`: `valid`, `invalid`, `blocked`, `unavailable`, `timeout`, `cancelled`, `output_limit`, or `failed`
- `target`: `project` or `file`; `file` is a safe relative path or `null`
- `exitCode` and `reason`: stable codes (e.g. `ir_verification_failed`, `compiler_rejected_source`, `structured_project_required`)
- `diagnostics`: at most 40 structured GNR diagnostic headers with optional known relative file path, code, severity, line/column, and **predefined sanitized message category**
- `diagnosticsTruncated`: whether the GNR diagnostic limit was exceeded
- `verification: "ir"`, `irIssueCount` (maximum 40) and `irIssuesTruncated`: counts of native verifier issue lines, never their raw text

When the native CLI reports `gungnirc: error: invalid C++ IR`, verification returns `state: "invalid"` and `reason: "ir_verification_failed"`. If semantic analysis fails before IR verification, GNR diagnostics are returned and the reason remains `compiler_rejected_source`. The tool marks nonvalid outcomes with MCP `isError: true`.

## Testing and limitations

Group 8 adds deterministic service fixtures for successful project/file verification, legacy refusal, symlink and traversal blocking, timeout/cancellation, GNR diagnostics, verifier failure counts, truncation, and source-data redaction. Real MCP integration tests cover denied and malformed requests in legacy and modern protocol sessions. POSIX CI also executes an allowlisted harmless script fixture and confirms the exact `--project … --verify-ir` argument sequence. Windows runs runner and protocol security tests.

**Production Gungnir compiler integration against SDK binaries is not claimed:** standard CI does not install a Gungnir release SDK. Release-binary semantic verification remains a follow-up integration requirement.

No PR, package publication, automatic deployment, source modification, database operation, or native application build is performed.
