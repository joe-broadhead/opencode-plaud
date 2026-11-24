#!/usr/bin/env node
/**
 * Runs the host suite (vitest project "host") once, on the locked `@opencode/sdk` 2.4.1 in node_modules.
 * Extra arguments go to vitest.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const result = spawnSync("npx", ["vitest", "run", "--project", "host", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" })
process.exitCode = result.status ?? 1
