# Local setup

## Prerequisites

1. Install Node.js 24.
2. Clone `justinangeloperez327/gungnir-mcp`.
3. Run `npm ci` (lockfile committed to `main`).
4. Run `npm run lint && npm run typecheck && npm run build && npm test`.
5. Point your MCP host to `node dist/index.js`.

## VS Code example

Use an absolute path to the local clone's compiled `dist/index.js` in a workspace `.vscode/mcp.json` file:

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

Other MCP clients use their own configuration conventions. The server responds to both legacy and 2026-07-28 protocol opening messages through the official TypeScript SDK. See [protocol](protocol.md) for details.

## Package

`npm run pack:check` inspects packaging but does not publish. CI uploads build archives but does not publish or deploy.
