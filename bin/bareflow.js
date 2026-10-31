#!/usr/bin/env node
// bareflow CLI: bareflow <url> [--json] | bareflow --version.
import { main } from "../src/cli.js";

// A failed log write must not cost the output. stderr only: a silenced stdout could exit 0 having delivered nothing.
process.stderr.on("error", () => {});
process.exitCode = await main(process.argv.slice(2));
