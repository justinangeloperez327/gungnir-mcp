# Gungnir project intelligence (Group 6)

Group 6 adds two **read-only** MCP tools, usable through both the legacy and modern MCP protocol. Neither tool accepts a path, directory, glob, or arbitrary options in its input schema.

| Tool | Returns |
| --- | --- |
| `gungnir_project_info` | profile, marker status, sanitized project name, module count and categories, basic directory-presence checks, truncation and diagnostic codes |
| `gungnir_list_modules` | up to 200 relative `.gnr` file paths, dotted module names, declaration categories, truncation and diagnostics |

## Trust configuration

A project is accessible only when the MCP server was started with **both** an absolute `--project-root` and an explicit absolute `--trusted-root`, or equivalent trusted environment settings. No project is inferred from cwd or MCP input. Without trust, these tools return a generic MCP tool error.

```sh
node dist/index.js --project-root /work/my-gungnir-app --trusted-root /work
```

At inspection time, the scanner revalidates the canonical root and its containment in the configured trust allowlist. Directory entries are examined using filesystem metadata. Symlinks, junctions, hidden directories, build artifacts, generated output and sensitive paths are never traversed.

## Project profiles

Gungnir's `.gungnir-project` file is a small `key=value` text marker. `profile=structured` identifies a structured project. A marker without a profile, or no marker at all, is identified as legacy/compatibility. A malformed, oversized, or unrecognized profile produces `profile=invalid`, rather than pretending to recognize it.

The only source text read is the project marker, capped at **4 KiB**. Even the marker's `name` is returned only if it passes conservative filename-safe validation. Other marker fields are not returned.

For structured projects the scanner notes the existence of `app`, `routes`, `database` and `bootstrap` directories, and reports structural warnings (for example, missing `app` or routes). These are **not grammar or semantic diagnostics**; the native compiler checks belong to Group 7.

## Modules and categories

Each eligible `.gnr` file produces a relative, slash-normalized path and a dotted module name based on its path; for example `app/models/User.gnr` becomes `app.models.User`. Categories cover models, controllers, middleware, requests, events, listeners, policies, notifications, mail, jobs, routes and database migrations. The fallback category is `other`.

The scanner **never reads `.gnr` contents**, resolves no imports, and does not claim that the module declaration agrees with the filename.

## Bounded discovery

| Limit | Value |
| --- | --- |
| Maximum examined directory entries | **2,048** |
| Maximum directory depth | **12** |
| Maximum returned modules | **200** |
| Maximum project marker size | **4 KiB** |

Generated and sensitive directories such as `.git`, `.gungnir`, `vendor`, `build`, `node_modules`, `storage`, `.env`, `secrets`, `credentials`, and `dist` are excluded. Nonconforming or sensitive-looking filenames are ignored. Traversal never follows symlinks or junctions, including to otherwise trusted directories.

If any limit is reached, `truncated=true` and diagnostic codes such as `scan_truncated`, `module_limit_reached` or `max_depth_reached` are returned. Counts then refer **only to examined and returned modules**, not necessarily the entire project. No absolute paths, file contents, secret values or raw filesystem exceptions are returned.

## Example output

`gungnir_project_info`:

```json
{
  "profile": "structured",
  "marker": "present",
  "name": "inventory",
  "moduleCount": 2,
  "categories": { "models": 1, "routes": 1 },
  "structure": { "app": true, "routes": true, "database": false, "bootstrap": false },
  "truncated": false,
  "scannedEntries": 8,
  "diagnostics": []
}
```

The example is illustrative; actual counts depend on the project.

`gungnir_list_modules` entries contain `path`, `module` and `category`. These paths must be treated as metadata, **not as authorization** for later edits or code execution.

## Security scope

The same-tree metadata scanner is not a race-free filesystem sandbox when an untrusted process can modify entries during enumeration. Later file access and native compiler operations require their own safeguards, including scoped handles or equivalent containment, typed argument allowlists and authorization. No build, generation, migration, file content, or mutation tool is introduced in Group 6.
