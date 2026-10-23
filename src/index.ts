#!/usr/bin/env node
import { reportProtocolError, startStdioServer } from "./lifecycle.js";

// The MCP protocol owns stdout; errors go to stderr only.
try {
  startStdioServer();
} catch (error) {
  reportProtocolError(error);
  process.exitCode = 1;
}
