# Secure native process runner — Groups 5–8

The internal `src/process-runner.ts` module is used by toolchain discovery and trusted native compiler checks. **It is not exposed as a generic MCP tool.**

## Explicit command allowlist

| Native tool | Allowed operation | Actual arguments |
| --- | --- | --- |
| `gungnir` | `version` | `--version` |
| `gungnirc` | `version` | `--version` |
| `cmake` | `version` | `--version` |
| `gungnirc` | `check_project` | `--project <validated-root> --check` |
| `gungnirc` | `check_file` | `<validated-indexed-.gnr-file> --check` (optional `--compat` for legacy) |
| `gungnirc` | `verify_ir_project` | `--project <validated-structured-root> --verify-ir` |
| `gungnirc` | `verify_ir_file` | `<validated-indexed-structured-.gnr-file> --verify-ir` |

Every other operation—including `build`, `run`, `dev`, `migrate`, `--format`, IR output dumps, arbitrary compiler flags, mixed `--check`/`--verify-ir`, and `-o`—is denied. The request type exposes **no arbitrary argv, shell, environment or working directory**; compiler checks instead use canonical trusted project/file paths validated before spawning. The MCP caller does not receive a process-runner endpoint.

## Executable validation

The runner resolves a selected absolute executable using `realpath`. The canonical basename must match the requested tool (`gungnir`, `gungnirc`, or `cmake`, with `.exe` on Windows), and the target must be a regular file; POSIX executables must have an execute bit. Relative paths, other extensions and Windows batch wrappers are rejected.

## Resource and cancellation controls

- `spawn` with `shell: false`, `windowsHide: true`, and `stdin` ignored
- Fixed allowlisted `--version`, `--check` or `--verify-ir` args only; no arbitrary project-supplied arguments
- Child working directory: the host's temporary directory (not a Gungnir project)
- Sanitized environment: only PATH, SystemRoot, WINDIR, TEMP, TMP, HOME and USERPROFILE (case-insensitive selection); no `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, app secrets or npm variables
- Version timeout default **3 seconds** (max **10 seconds**); compiler-check default **10 seconds** (max **30 seconds**)
- Version combined stdout/stderr cap default **8 KiB**; compiler-check default **32 KiB**; both max **64 KiB**
- `AbortSignal` support before launch and while running
- On POSIX, processes are detached into a process group which is terminated on abort, timeout, or output overflow
- On Windows, the direct process is terminated; process-tree termination cannot be guaranteed without Windows Job Objects or comparable OS controls
- An expected zero-exit result returns captured output to the trusted internal caller; compiler nonzero exits retain bounded stderr *internally* for diagnostic-header normalization and redacted verifier failure counts; no raw stderr is exposed by public MCP tools, and all other errors return structured failure categories

Validation and cancellation do not make executing an untrusted native executable safe. A malicious `--version` handler can still have side effects. Only run the server with trusted SDK installations and executable search paths.

## Test coverage

Node 24 Windows/Linux CI exercises command rejection, executable path validation, invalid resource limits, cancellation, output overflow, environment isolation, and real-process version probes. On Linux, additional fixture processes test SIGKILL/group termination, timeout, nonzero exits and runtime cancellation.

## Future Groups

Group 7 adds compiler checks; Group 8 adds structured-project and structured-file C++ IR verification through the same trust boundary. Application builds, generators and migrations require separately audited typed allowlists, path/file-handle security, and explicit authorization. There is deliberately no public process-execution tool.
