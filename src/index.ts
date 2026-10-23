#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

// MCP owns stdout. Never log to stdout from this entry point.
serveStdio(createServer);
