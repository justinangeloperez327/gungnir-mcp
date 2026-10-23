# Group 5 secure native process runner

The internal `src/process-runner.ts` module is used by read-only toolchain discovery. **It is not exposed as a generic MCP tool.**

## Explicit command allowlist

| Native tool | Allowed operation | Actual arguments |
| --- | --- | --- |
| `gungnir` | `version` | `--version` |
| `gungnirc` | `version` | `--version` |
| `cmake` | `version` | `--version` |

Every other operation—including `build`, `run`, `dev`, `migrate`, and compiler project checks—is denied in Group 5. The request type exposes **no arbitrary argv, shell, environment or working directory**. The MCP caller does not receive a process-runner endpoint.

## Executable validation

The runner resolves a selected absolute executable using `realpath`. The canonical basename must match the requested tool (`gungnir`, `gungnirc`, or `cmake`, with `.exe` on Windows), and the target must be a regular file; POSIX executables must have an execute bit. Relative paths, other extensions and Windows batch wrappers are rejected.

## Resource and cancellation controls

- `spawn` with `shell: false`, `windowsHide: true`, and `stdin` ignored
- Fixed `--version` args, no project-supplied arguments
- Child working directory: the host's temporary directory (not a Gungnir project)
- Sanitized environment: only PATH, SystemRoot, WINDIR, TEMP, TMP, HOME and USERPROFILE (case-insensitive selection); no `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, app secrets or npm variables
- Default timeout **3 seconds**; maximum **10 seconds**
- Default combined stdout/stderr cap **8 KiB**; maximum **64 KiB**
- `AbortSignal` support before launch and while running
- On POSIX, processes are detached into a process group which is terminated on abort, timeout, or output overflow
- On Windows, the direct process is terminated; process-tree termination cannot be guaranteed without Windows Job Objects or comparable OS controls
- An expected zero-exit result returns captured output to the trusted internal caller; all error cases return structured failure categories without raw process text

Validation and cancellation do not make executing an untrusted native executable safe. A malicious `--version` handler can still have side effects. Only run the server with trusted SDK installations and executable search paths.

## Test coverage

Node 24 Windows/Linux CI exercises command rejection, executable path validation, invalid resource limits, cancellation, output overflow, environment isolation, and real-process version probes. On Linux, additional fixture processes test SIGKILL/group termination, timeout, nonzero exits and runtime cancellation.

## Future Groups

Group 6 remains focused on read-only project metadata. Project code checks, builds, generators and migrations require separately audited typed allowlists, path/file-handle security, and explicit authorization. There is deliberately no public process-execution tool.
