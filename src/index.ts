import { loadRuntimeConfig } from "./config.js";
import { reportProtocolError, startStdioServer } from "./lifecycle.js";

// Resolve and validate operator trust before accepting MCP requests.
// The MCP protocol owns stdout; errors go to stderr only.
async function main(): Promise<void> {
  const config = await loadRuntimeConfig();
  startStdioServer(config);
}

void main().catch((error: unknown) => {
  reportProtocolError(error);
  process.exitCode = 1;
});
