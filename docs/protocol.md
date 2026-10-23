# MCP protocol interoperability and troubleshooting

## Supported wire modes

The official v2 SDK's `serveStdio` selects an era from the first inbound message:

- **Legacy** (2025 era): `initialize` followed by `notifications/initialized`.
- **Modern** (2026-07-28): `server/discover` and `_meta` envelopes without the legacy initialize handshake.

The default client connection in the official v2 Client remains **legacy**. A client with `versionNegotiation: { mode: { pin: "2026-07-28" } }` negotiates modern mode. A client with `mode: "auto"` may spawn an extra process to probe over stdio. The server uses `legacy: "serve"` for backward compatibility.

## Testing

```bash
npm ci
npm run build
npm test
npx @modelcontextprotocol/inspector node dist/index.js
```

Unit tests cover idempotent shutdown, signal listeners, and stderr-only transport reporting. Integration tests spawn the compiled server and use the official MCP Client to list/call the read-only status tool in both protocol eras, exercise tool-request error recovery and test EOF shutdown.

## Diagnostics

- **No output after launching `node dist/index.js`:** expected. A stdio MCP server waits for a client.
- **No connection:** verify Node 24, the compiled path, host working directory and client transport configuration.
- **Unexpected response parse error:** make sure no `console.log`, ANSI terminal banner or other non-protocol bytes are written to stdout.
- **Unknown tool:** currently only `gungnir_status` exists. Other names should return a protocol tool error without dropping the connection.
- **EOF:** closing client stdin must terminate a server with no extra keep-alive resources.
- **Transport errors:** diagnostics appear on stderr; do not add stack dumps or secrets to tool responses.

The server is local-only. No remote HTTP listener is configured.
