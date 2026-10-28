#!/usr/bin/env node
// bareflow CLI: bareflow <url> [--json] | bareflow --version.
import { main } from "../src/cli.js";

process.exitCode = await main(process.argv.slice(2));
