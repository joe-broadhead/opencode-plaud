#!/usr/bin/env node
/**
 * Runs the host suite (vitest project "host") once per tested OpenCode release, `TESTED_HOSTS` in src/version.ts.
 * The release in the lockfile (@opencode/sdk 2.2.3) runs on node_modules. Each other one runs on
 * HOST_SDK_DIR_<version> (such as HOST_SDK_DIR_2_2_5), a folder whose node_modules holds that @opencode/sdk, or else
 * on @opencode/sdk@<version> installed with scripts off, once per run, into a folder under /tmp that is removed
 * afterwards. No lockfile ever gets a second SDK. With HOST_SDK_DIR set, it runs once, on that SDK only.
 * Extra arguments go to vitest.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const source = await build({
  stdin: { contents: 'export { TESTED_HOSTS } from "./src/version.ts"', resolveDir: ROOT, loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  define: { __PLUGIN_VERSION__: '"host-tests"' },
  logLevel: "silent",
})
const { TESTED_HOSTS } = await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString("base64")}`)
const locked = JSON.parse(readFileSync(join(ROOT, "node_modules", "@opencode", "sdk", "package.json"), "utf8")).version
const installed = []

function install(version) {
  // Under /tmp, never below HOME, where OpenCode's upward search finds .opencode folders.
  const dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), `opencode-plaud-sdk-${version}-`)))
  installed.push(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "opencode-plaud-host-sdk", private: true }))
  const result = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@opencode/sdk@${version}`], { cwd: dir, encoding: "utf8" })
  if (result.status !== 0 || !existsSync(join(dir, "node_modules", "@opencode", "sdk", "package.json"))) {
    throw new Error(`could not install @opencode/sdk@${version}:\n${result.stderr}`)
  }
  return dir
}

const runs = process.env.HOST_SDK_DIR
  ? [{ label: `HOST_SDK_DIR (${process.env.HOST_SDK_DIR})`, dir: process.env.HOST_SDK_DIR }]
  : TESTED_HOSTS.map((version) => ({ label: version, version }))

const failed = []
try {
  for (const run of runs) {
    const dir = run.dir ?? (run.version === locked ? undefined : (process.env[`HOST_SDK_DIR_${run.version.replaceAll(".", "_")}`] ?? install(run.version)))
    console.log(`\nhost suite on @opencode/sdk ${run.label}${dir ? ` from ${dir}` : " from the lockfile"}`)
    const env = { ...process.env }
    delete env.HOST_SDK_DIR
    if (dir) env.HOST_SDK_DIR = dir
    const result = spawnSync("npx", ["vitest", "run", "--project", "host", ...process.argv.slice(2)], { cwd: ROOT, env, stdio: "inherit" })
    if (result.status !== 0) failed.push(run.label)
  }
} finally {
  for (const dir of installed.splice(0)) rmSync(dir, { recursive: true, force: true })
}
if (failed.length > 0) {
  console.error(`host suite failed on: ${failed.join(", ")}`)
  process.exitCode = 1
} else console.log(`host suite: passed on ${runs.map((run) => run.label).join(", ")}`)
