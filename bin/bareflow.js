#!/usr/bin/env node
// bareflow CLI: bareflow <url> [--json] | bareflow --version | bareflow mcp.
import { main, mcp } from "../src/cli.js";

// A failed log write must not cost the output. stderr only: a silenced stdout could exit 0 having delivered nothing.
process.stderr.on("error", () => {});
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "mcp") {
  // stdout is JSON-RPC alone from here: every other write in this thread goes to stderr. A write's own
  // callback carries a closed stdout. process.exit: a handle left open must not outlive the client.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  process.stdout.on("error", () => {});
  process.exit(await mcp({ write, err: (s) => process.stderr.write(s) }));
}
process.exitCode = await main(args);
