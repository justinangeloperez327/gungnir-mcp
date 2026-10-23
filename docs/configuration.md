# Configuration and project trust (Group 3)

By default the MCP server has no project access. The current process working directory is **not** implicitly trusted.

## Startup inputs

| CLI argument | Environment variable | Meaning |
| --- | --- | --- |
| `--project-root PATH` | `GUNGNIR_MCP_PROJECT_ROOT` | Existing absolute directory containing one project |
| Repeatable `--trusted-root PATH` | `GUNGNIR_MCP_TRUSTED_ROOTS` | Existing absolute parent directory allowlist |

The environment allowlist uses Node.js `path.delimiter` (`:` on Unix, `;` on Windows). When flags are provided, `--project-root` overrides the environment project root; one or more `--trusted-root` flags replace the environment allowlist. Unknown flags, missing values, duplicate project-root flags and more than 16 trust entries fail startup.

A project must be contained within at least one **explicitly** permitted trusted root. A project without trust, or trust without a project, is rejected. Every configured root is canonicalized with `realpath`, required to be an existing directory and compared using segment-aware `path.relative` to block path-prefix mistakes and root symlink escapes.

## Examples

Linux:

```sh
node dist/index.js --project-root /home/dev/inventory --trusted-root /home/dev
```

PowerShell:

```powershell
node dist/index.js --project-root "C:\Projects\inventory" --trusted-root "C:\Projects"
```

Environment on Linux:

```sh
export GUNGNIR_MCP_PROJECT_ROOT=/home/dev/inventory
export GUNGNIR_MCP_TRUSTED_ROOTS=/home/dev
node dist/index.js
```

## Existing-path guard

`resolveExistingProjectPath(config, relativePath)` is a helper for future read-only operations. It verifies that an **existing** project-relative path resolves below the canonical project directory. It rejects absolute paths (including Windows drive and UNC forms), NUL bytes, `..` traversal, colon-containing Windows stream-like paths, missing targets, and symlinks/junctions resolving outside the project.

**Security boundary:** this is not a race-free file sandbox. Do not use it alone to authorize writes, execute code, or inspect sensitive paths in a concurrently mutable workspace. Later groups must combine validated handles, fresh checks and command-specific permissions. An operator allowlist is not permission for an AI tool to execute or mutate arbitrary files.

`gungnir_status` only returns whether access is disabled or trusted; project paths are never returned.

## Native SDK discovery configuration (Group 4)

Toolchain discovery is independent of project trust. Set `GUNGNIR_MCP_SDK_ROOT` or `GUNGNIR_CMAKE_PREFIX` to an existing absolute Gungnir SDK root, or use a trusted `PATH`. A configured override is strict; it does not fall back to another Gungnir executable found on PATH. See [Toolchain discovery](toolchain.md).

## Project metadata access (Group 6)

`gungnir_project_info` and `gungnir_list_modules` require both a configured project and explicitly trusted root. With no project, startup still succeeds but either tool returns a generic MCP error without disclosing private paths. Tool arguments cannot override the root or read arbitrary files. Scans recheck root trust and avoid symlink following.

Relative `.gnr` file paths and sanitized module names are returned; source-file content is not read. Even metadata can reveal project details, so only configure projects intended for the connected MCP client. See [Project intelligence](project-intelligence.md).

## Official docs and SDK resources (Group 9)

Version-pinned `gungnir://docs/1.0.2/*` documentation resources need no project root, SDK installation, internet connection, API key, or native compiler. The SDK resource reads a local manifest only when an operator sets `GUNGNIR_MCP_SDK_ROOT` or `GUNGNIR_CMAKE_PREFIX` to an existing absolute SDK directory. Strict override precedence is retained; an invalid explicit SDK path will not fall back to PATH, to the working directory, or to a project-provided value. See [Documentation resources](documentation-resources.md).
