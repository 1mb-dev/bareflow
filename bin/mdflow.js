#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json]. Set MDFLOW_LOG=<file> to append one JSON line per use.
import { main } from "../src/cli.js";

process.exitCode = await main(process.argv.slice(2), { env: process.env });
