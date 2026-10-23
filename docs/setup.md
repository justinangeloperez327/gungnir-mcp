# Local setup

## Prerequisites

1. Install Node.js 24.
2. Clone `justinangeloperez327/gungnir-mcp`.
3. Run `npm ci` (a committed `package-lock.json` is produced as part of Group 1 bootstrap).
4. Run `npm run lint && npm run typecheck && npm run build && npm test`.
5. Launch `node dist/index.js` from your MCP host.

An MCP server over stdio can appear to wait when run directly in a terminal. This is expected; an MCP client exchanges JSON-RPC messages on its standard streams.

## Example client configuration

Use an absolute path to your local clone's compiled `dist/index.js`:

```json
{
  "servers": {
    "gungnir": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/gungnir-mcp/dist/index.js"]
    }
  }
}
```

MCP host configuration keys vary by product. The example above is a VS Code `.vscode/mcp.json` structure. Group 15 will add verified client-specific configurations.

## Package

`npm run pack:check` inspects packaging but does not publish. No deployment or publication occurs in CI.
