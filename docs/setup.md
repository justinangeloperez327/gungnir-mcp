# Local setup

1. Install Node.js 24.
2. Clone `justinangeloperez327/gungnir-mcp`.
3. Run `npm ci` using the committed lockfile.
4. Run `npm run lint && npm run typecheck && npm run build && npm test`.
5. Launch `node dist/index.js` from an MCP host.

## VS Code example

Use an absolute path to `dist/index.js` in workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "gungnir": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/gungnir-mcp/dist/index.js",
        "--project-root",
        "/absolute/path/to/your/project",
        "--trusted-root",
        "/absolute/path/to/your/trusted/parent"
      ]
    }
  }
}
```

Remove the trust flags to use read-only status with project access disabled. On Windows supply absolute paths using escaped backslashes in JSON, or forward slashes. See [Configuration](configuration.md) for environment alternatives.

Package verification with `npm run pack:check` does not publish. CI uploads build archives only.

## Checking project intelligence

Once connected with explicit `--project-root` and `--trusted-root`, the MCP host may invoke `gungnir_project_info` to inspect project profile/structure and `gungnir_list_modules` to inspect the sanitized `.gnr` module index. Both tools are read-only, accept no file-path argument and do not require a native SDK installation. See [Project intelligence](project-intelligence.md).

## Documentation resources

After connecting, call `resources/list` to discover `gungnir://docs/catalog`, 16 pinned official `gungnir://docs/1.0.2/<topic>` pages, and `gungnir://sdk/capabilities`. Use `resources/read` with an exact listed URI. No project trust or native compiler is required for the bundled docs. When a local SDK is explicitly selected, the SDK resource reports its parsed package version, profile, capabilities and whether the SDK matches the bundled documentation version.
