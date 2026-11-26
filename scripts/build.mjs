#!/usr/bin/env node
/**
 * Build the server entry OpenCode loads: one self-contained `dist/index.js`.
 *
 * Every first-party module and the contract's runtime modules are inlined; `@opencode/*` stays external, because the
 * host provides it. There is no runtime dependency and no chunk. OpenCode reloads a plugin in place and keeps the
 * modules it already loaded for unchanged paths, so a sibling module could be stale.
 *
 * NOTICE carries the licence of every inlined package, read from each output's own inputs. The build fails when NOTICE
 * no longer matches what it bundled; `--check-notice` only checks, and `--notice` rewrites it.
 */
import { build } from "esbuild"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opencode/schema", "@opencode/schema/*"]
const allowed = (path) => path.startsWith("node:") || builtinModules.includes(path) || HOST.some((name) => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: { index: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
  // The YAML parser is CommonJS and reads `process` with require(); the bundle is ESM, so give it a real require.
  banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
})

const unexpected = Object.entries(result.metafile.outputs).flatMap(([file, output]) => [
  ...(Object.keys(output.inputs).length === 0 ? [`${file}: empty`] : []),
  ...output.imports.filter((entry) => !entry.external || !allowed(entry.path)).map((entry) => `${file}: ${entry.path}`),
])
if (unexpected.length > 0) {
  console.error(`build: outputs import modules that are neither inlined nor provided by the host:\n  ${unexpected.join("\n  ")}`)
  process.exit(1)
}

// Each output's own inputs, counting only code that reached it, so a package one bundle tree-shakes away is not listed.
const bundled = new Map()
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    const name = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]
    if (name === undefined || bytesInOutput === 0) continue
    bundled.set(name, new Set([...(bundled.get(name) ?? []), relative(ROOT, join(ROOT, file))]))
  }
}
// A bundled dist can inline its own dependencies; plugin-contract's chunks carry the original module path in a
// comment (`// node_modules/zod/v4/...`). Those packages are redistributed by this bundle too.
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  for (const input of Object.keys(output.inputs)) {
    if (!input.startsWith("node_modules/")) continue
    const text = readFileSync(join(ROOT, input), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      const name = match[1]
      if (!existsSync(join(ROOT, "node_modules", name, "package.json"))) continue
      bundled.set(name, new Set([...(bundled.get(name) ?? []), relative(ROOT, join(ROOT, file))]))
    }
  }
}
const notices = [...bundled.keys()].sort().map((name) => {
  const root = join(ROOT, "node_modules", name)
  const { version, license } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const file = readdirSync(root).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
  if (!file) throw new Error(`build: ${name} is bundled but ships no licence file`)
  return `## ${name} ${version} (${license}), in ${[...bundled.get(name)].sort().join(" and ")}\n\n${readFileSync(join(root, file), "utf8").trim()}\n`
})
const notice = `This package bundles this third-party code into dist/.\n\n${notices.join("\n")}`
const current = readFileSync(join(ROOT, "NOTICE"), "utf8")
if (process.argv.includes("--notice")) writeFileSync(join(ROOT, "NOTICE"), notice)
else if (current !== notice) {
  console.error("build: NOTICE does not match the bundled packages. Run `node scripts/build.mjs --notice` to rewrite it.")
  process.exit(1)
}

for (const [file, output] of Object.entries(result.metafile.outputs)) {
  console.log(`built ${relative(ROOT, join(ROOT, file))} (${(output.bytes / 1024).toFixed(1)} KiB)`)
}
