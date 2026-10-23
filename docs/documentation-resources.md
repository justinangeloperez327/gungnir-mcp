# Version-aware official Gungnir documentation resources (Group 9)

Group 9 adds MCP `resources/list` and `resources/read` using the official v2 SDK's static `registerResource` API. All 18 resources are **read-only**, accessible over existing local stdio connections, and use exact URIs (no dynamic resource templates, arbitrary file paths or runtime internet access).

## Authoritative documentation snapshot

A fixed snapshot of **16 complete official markdown guides** was copied from [Gungnir `v1.0.2`](https://github.com/justinangeloperez327/gungnir/tree/v1.0.2/docs) at commit `90cb063eca81f121c78c8ab77b8dea67143dbad1`. Files are bundled in `src/official-docs.ts` as compiled, offline content; the public `gungnir://docs/catalog` resource includes their original source path/URL and Git blob SHA.

Documentation resource URI: `gungnir://docs/1.0.2/<slug>`.

Topics: `getting-started`, `grammar`, `language-types`, `statements`, `expressions`, `model`, `controller`, `routing`, `middleware`, `orm`, `migration`, `validation`, `authentication`, `view`, `sdk-packages`, and `modules`.

Each read enforces an explicit slug allowlist, pinned release version, a maximum **32 KiB UTF-8 response**, original source-path shape, and exact Git blob SHA verification. An altered or unexpected document is rejected. Unsupported releases or topic names are **not** silently mapped to this snapshot.

## Resource catalog

`gungnir://docs/catalog` returns JSON containing the framework, documentation version, source tag, commit and the exact URIs/title/source URLs/Git hashes of all 16 pages. Clients should enumerate `resources/list`, then read one of the advertised fixed URIs. There are no external HTTP requests made by MCP resource reads.

The snapshot version is the version of the **bundled docs**, not a claim that the user's installed SDK always matches them. A later framework version requires a separately audited, tagged doc snapshot.

## Installed SDK capabilities

`gungnir://sdk/capabilities` returns a sanitized JSON resource. It reads an installed `share/gungnir/sdk.txt` **only** when the MCP server operator sets an absolute `GUNGNIR_MCP_SDK_ROOT` or `GUNGNIR_CMAKE_PREFIX` at process launch; the former takes precedence.

The SDK resource does **not** search PATH, infer project-relative directories, accept URI path parameters, execute any native tools or read credentials. It rejects relative/absent roots, symlinks/junctions in marker paths, malformed or oversized files, duplicate fields, unknown SDK profiles, invalid version strings or adapter values other than `ON` and `OFF`.

The marker maximum is **16 KiB**. The result includes only:

- `state`: `not_configured`, `ready`, `incompatible`, or `invalid`
- `version`, `profile` (`core`, `application`, `custom` or null)
- `adapters`: selected allowlisted boolean flags for SQLite, password, PostgreSQL, MySQL, SQL Server, MongoDB, Redis, SMTP, OpenTelemetry, TLS, HTTP/2 and S3
- `matchesDocumentationVersion`, `documentationVersion`, and a fixed `reason` code

Other manifest fields (paths, compiler identifiers, platform details and arbitrary metadata) are never returned. An installed SDK different from `1.0.2` is reported as `incompatible` **for this pinned documentation snapshot**; this is not a declaration that the SDK itself cannot run.

## Security boundaries and test coverage

Both legacy and modern MCP clients can list and read the same resources. Unit tests cover the exact source snapshot, hash verification, resource length, unsupported URIs, marker field injection, duplicate keys, disabled SDK lookup, prefix precedence, size caps, and symlink/junction escapes. Integration tests exercise `resources/list`, `resources/read`, catalog integrity, invalid URI refusal, and session recovery on Node 24 Windows and Linux.

A malicious local actor capable of changing the marker during a read may still induce a filesystem race. The resource reader uses bounded file-handle reads and rejects symlinks at validation, but it is not a general OS sandbox. SDK metadata should only be enabled for a trusted local installation.

Group 10 will add offline documentation **search** on top of these immutable resources. Group 9 deliberately provides resource enumeration and exact reads, not a search index.
