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
