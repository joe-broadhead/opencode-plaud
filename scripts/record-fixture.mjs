#!/usr/bin/env node
/**
 * Runs `scripts/record-fixture.ts` with esbuild, so it can import the TypeScript sources.
 *
 * The bundle is written to `dist/` because `src/manifest.ts` reads `../package.json` beside itself: from
 * `dist/record-fixture.mjs` that is the repository's own manifest, exactly as it is from `dist/index.js` at runtime.
 */
import { build } from "esbuild"
import { rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(ROOT, "dist", "record-fixture.mjs")
await build({
  absWorkingDir: ROOT,
  entryPoints: ["scripts/record-fixture.ts"],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["@opencode/plugin", "@opencode/plugin/*", "@opencode/schema", "@opencode/schema/*"],
  legalComments: "none",
  logLevel: "warning",
})
try {
  await import(pathToFileURL(out).href)
} finally {
  rmSync(out, { force: true })
}
