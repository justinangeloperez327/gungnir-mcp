# Security policy and project boundaries

## Implemented through Group 9

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
- Trusted project inspection tools accept no user-controlled filesystem paths, recursively skip hidden, generated, and sensitive directories, and do not follow symlinks or junctions.
- Only the small `.gungnir-project` marker is read (maximum 4 KiB); source and secret file contents are never read.
- Every discovered module path is validated as a safe, relative `.gnr` filename with bounded tree traversal (2,048 entries, 12 levels, 200 modules).
- Group 7 allows only fixed `gungnirc --project <root> --check` for structured projects and `gungnirc <indexed-file> --check` for individual files (plus `--compat` for legacy files). No native application build, output target or file mutation is enabled.
- Checks require explicit project trust, a complete safe module scan, and canonical source/executable containment. Raw compiler output and source excerpts are not forwarded; only bounded normalized diagnostic headers are returned.
- Group 8 adds only fixed structured-project and structured-file `--verify-ir` commands. The native CLI rejects combinations with `--check`, `--compat`, formatting, dumps and output paths; these combinations are not exposed by the runner.
- Diagnostic text from a trusted native compiler is never forwarded verbatim: GNR severity, code and coordinates are kept while messages become safe predefined categories. Verifier issue text is counted, not displayed.
- Group 9 registers an explicit set of fixed documentation resource URIs and an exact versioned catalog; there are no path/template parameters, arbitrary URL retrieval, or network fetches during MCP reads.
- Bundled official v1.0.2 guides are limited to 32 KiB each and verified against upstream Git blob hashes at read time.
- SDK metadata comes exclusively from operator-supplied absolute SDK roots, not PATH or user-supplied resource URIs. The 16 KiB SDK marker must have safe nonsymlink path components, strictly parsed keys, valid version/profile and boolean adapters; unrecognized fields are not returned.
- SDK version mismatches are explicitly signaled; invalid/missing markers return redacted status codes without raw paths or secrets.
- No application builds, file writes, migrations or database calls.
- CI does not publish or deploy.

## Trust caveats

Reading binary version output requires *executing the binary's version handler*. A compromised or malicious executable on PATH or in an operator-specified SDK can perform side effects beyond the MCP server's control. Install trusted SDKs and keep PATH entries trusted. The MCP server is not an OS sandbox.

Project filenames themselves may be sensitive even when their contents are not. Apply repository-specific trust before exposing metadata. Canonical filesystem checks alone are not race-free if a project mutates symlinks concurrently. Before enabling native application operations, future groups must add project-specific command validation, race-resistant file access, separate permission gates for writes/builds, and stronger Windows subprocess-tree termination before allowing long-running application commands.

Report vulnerabilities privately through GitHub's vulnerability reporting feature when enabled.
