// The release tarball ships NOTICE next to a bundle that inlines third-party code. This test builds the server entry
// with the same options as scripts/build.mjs, collects every package that actually ends up in the bundle (including a
// package inlined by a bundled dist, such as zod inside plugin-contract), and requires each one's heading and verbatim
// licence text in NOTICE.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { describe, expect, test } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opencode/schema", "@opencode/schema/*"]
const PLUGIN = "@we-the-rebel-alliance/plaud-plugin"

/** A package name from an esbuild input path, or undefined for the plugin's own sources. */
function packageOf(path: string): string | undefined {
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)
  return match?.[1]
}

function keep(name: string | undefined): name is string {
  return name !== undefined && name !== PLUGIN && !name.startsWith("@opencode/") && !name.startsWith(".")
}

function section(name: string): RegExp {
  return new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "m")
}

/** The packages a NOTICE does not name, in the order they were found. */
export function missingNoticeSections(notice: string, packages: readonly string[]): string[] {
  return packages.filter((name) => !section(name).test(notice))
}

/** A package's licence text, trimmed exactly as the NOTICE generator writes it. */
export function licenseText(name: string): string {
  const directory = join(root, "node_modules", name)
  const file = readdirSync(directory).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
  if (file === undefined) throw new Error(`${name} ships no licence file`)
  return readFileSync(join(directory, file), "utf8").trim()
}

/** Every package this bundle actually inlines, including packages inlined by a bundled dist. */
export async function bundledPackages(): Promise<string[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: { index: "src/index.ts" },
    outdir: "dist",
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    external: HOST,
    legalComments: "none",
    write: false,
    metafile: true,
    logLevel: "silent",
    banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
  })
  const found = new Set<string>()
  const inputs = Object.keys(result.metafile.inputs)
  for (const path of inputs) {
    const name = packageOf(path)
    if (keep(name)) found.add(name)
  }
  // A bundled dist can inline its own dependencies; plugin-contract's chunks carry the original module path in a
  // comment (`// node_modules/zod/v4/...`). Those packages are redistributed by this bundle too.
  for (const path of inputs) {
    if (!path.startsWith("node_modules/")) continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      const name = match[1]
      if (keep(name) && existsSync(join(root, "node_modules", name, "package.json"))) found.add(name)
    }
  }
  return [...found].sort()
}

describe("the bundled third-party notices", () => {
  test("every bundled package has its heading and verbatim licence in NOTICE", async () => {
    const packages = await bundledPackages()
    expect(packages).toContain("yaml")
    expect(packages).toContain("zod")
    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    expect(missingNoticeSections(notice, packages)).toEqual([])
    for (const name of packages) {
      const pkg = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")) as {
        version: string
        license: string
      }
      expect(notice).toContain(`## ${name} ${pkg.version} (${pkg.license})`)
      expect(notice).toContain(licenseText(name))
    }
  })

  test("a missing section is reported", () => {
    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    const withoutYaml = notice.replace(/^## yaml[\s\S]*?(?=^## |\s*$)/m, "")
    expect(missingNoticeSections(withoutYaml, ["yaml"])).toEqual(["yaml"])
  })
})
