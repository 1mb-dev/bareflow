#!/usr/bin/env node
// bareflow CLI: bareflow <url> [--json].
import { main } from "../src/cli.js";

process.exitCode = await main(process.argv.slice(2));
