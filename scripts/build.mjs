#!/usr/bin/env node
/**
 * Build the two entries OpenCode loads, each one self-contained file:
 * dist/index.js (the server part, src/index.ts) and dist/tui.js (the TUI
 * part, src/tui.tsx). First-party code, such as the RPC contract both parts
 * use, is inlined into each, and zod into the server part, where the tool and
 * option schemas use it; there are no chunks and no relative
 * imports. OpenCode reloads a plugin in place and keeps the modules it
 * already loaded for unchanged paths, so a sibling module could be stale.
 *
 * OpenCode compiles TSX only outside node_modules, so the TUI's JSX goes
 * through Solid's universal transform for @opentui/solid before esbuild
 * bundles it. The sources import zod as `import * as z`, which lets esbuild
 * drop the parts the plugin never uses. The host provides @opencode/plugin,
 * OpenTUI and Solid to plugins, so they stay bare imports. The build fails
 * if an output imports anything else.
 *
 * NOTICE carries the licence of every inlined package, and nothing else,
 * with the bundles each one is in, read from each output's own inputs. The
 * build fails when NOTICE no longer matches what it bundled; run
 * `node scripts/build.mjs --notice` to rewrite NOTICE.
 */
import { transformAsync } from "@babel/core"
import { build } from "esbuild"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opentui/*", "solid-js", "solid-js/*"]
const allowed = (path) => path.startsWith("node:") || HOST.some((name) => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))

/** Solid's universal JSX transform for OpenTUI, after TypeScript stripping. */
const solid = {
  name: "solid",
  setup(plugin) {
    plugin.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const result = await transformAsync(readFileSync(path, "utf8"), {
        filename: path,
        configFile: false,
        babelrc: false,
        sourceMaps: false,
        presets: [
          ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
          ["@babel/preset-typescript", { onlyRemoveTypeImports: false }],
        ],
      })
      if (!result?.code) throw new Error(`build: Babel produced no output for ${relative(ROOT, path)}`)
      return { contents: result.code, loader: "js" }
    })
  },
}

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: { index: "src/index.ts", tui: "src/tui.tsx" },
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST,
  plugins: [solid],
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
})

const unexpected = Object.entries(result.metafile.outputs).flatMap(([file, output]) => [
  ...Object.keys(output.inputs).length === 0 ? [`${file}: empty`] : [],
  ...output.imports.filter((entry) => !entry.external || !allowed(entry.path)).map((entry) => `${file}: ${entry.path}`),
])
if (unexpected.length > 0) {
  console.error(`build: outputs import modules that are neither inlined nor provided by the host:\n  ${unexpected.join("\n  ")}`)
  process.exit(1)
}
// Each output's own inputs, counting only code that reached it, so a package one bundle tree-shakes away is not listed for it.
const bundled = new Map()
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    const name = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]
    if (name === undefined || bytesInOutput === 0) continue
    bundled.set(name, new Set([...(bundled.get(name) ?? []), relative(ROOT, join(ROOT, file))]))
  }
}
const notices = [...bundled.keys()].sort().map((name) => {
  const root = join(ROOT, "node_modules", name)
  const { version, license } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const file = readdirSync(root).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
  if (!file) throw new Error(`build: ${name} is bundled but ships no licence file`)
  return `## ${name} ${version} (${license}), in ${[...bundled.get(name)].sort().join(" and ")}\n\n${readFileSync(join(root, file), "utf8").trim()}\n`
})
const notice = `opencode-plaud bundles this third-party code into dist/.\n\n${notices.join("\n")}`
if (process.argv.includes("--notice")) writeFileSync(join(ROOT, "NOTICE"), notice)
else if (readFileSync(join(ROOT, "NOTICE"), "utf8") !== notice) {
  console.error("build: NOTICE does not match the bundled packages. Run `node scripts/build.mjs --notice` to rewrite it.")
  process.exit(1)
}

for (const [file, output] of Object.entries(result.metafile.outputs)) {
  console.log(`built ${relative(ROOT, join(ROOT, file))} (${(output.bytes / 1024).toFixed(1)} KiB)`)
}
