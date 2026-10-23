# Contributing

This is a TypeScript/Node.js 24 project.

1. Install Node.js 24 and run `npm ci`.
2. Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` before submitting changes.
3. Keep changes within the current roadmap group. Avoid implementing native process execution without its explicit security review.
4. Do not log to stdout from the MCP entry point.
5. Prefer native Gungnir CLI/compiler behavior over duplicating framework semantics in TypeScript.

CI tests both Windows and Ubuntu. Publishing and deployment are manual decisions.
