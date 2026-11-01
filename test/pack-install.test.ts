import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform, tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startFakePlaud, type FakePlaud } from "./fixtures/fake-plaud.js"
import { forbiddenUses, moduleSpecifiers } from "./module-specifiers.js"

/**
 * The published shape: build, pack, and install the tarball alone, with
 * scripts off, into an empty project. Installed alone, it loads in each
 * stock OpenCode release, which provides @opencode/plugin, OpenTUI and Solid
 * itself; next to those packages, '.' and './tui' import under Bun.
 *
 * PACK_TARBALL tests a tarball that is already packed, such as the one a
 * release publishes. OPENCODE_BIN_2_2_3 and OPENCODE_BIN_2_2_4 name stock
 * binaries; otherwise each @opencode/cli release is installed with npm into
 * the temp directory.
 */

const REPO = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
  name: string
  version: string
  files: string[]
  exports: Record<string, string>
  devDependencies: Record<string, string>
}
const HOST_VERSIONS = ["2.2.3", "2.2.4"]
const TESTED_HOST = ">=2.2.3 <2.3.0"
const SKILLS = ["opencode-plaud", "opencode-plaud-digest", "opencode-plaud-export"]
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
const SERVER_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_MODULES = [...SERVER_MODULES, /^@opentui\/(?:core|solid)(?:\/|$)/, /^solid-js(?:\/|$)/]
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublish", "prepublishOnly", "publish", "postpublish"]
const UNDECLARED = ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies", "peerDependencies", "peerDependenciesMeta"]
/** Anything that tries the network goes to a closed port, except the loopback fake. */
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(tmpdir(), "opencode-plaud-pack-")))
let tarball: string
let packed: { filename: string; files: { path: string }[] } | undefined
let installed: string
let fake: FakePlaud

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...env, npm_config_update_notifier: "false" } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

/** An empty project, with its own package.json so npm never walks up. */
function project(name: string): string {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `opencode-plaud-pack-${name}`, private: true, type: "module" }))
  return dir
}

function install(name: string, extra: string[] = []): string {
  const dir = project(name)
  run("npm", ["install", tarball, ...extra, "--ignore-scripts", "--no-audit", "--no-fund", extra.length === 0 ? "--offline" : "--prefer-offline"], dir)
  return dir
}

const tree = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tree(root, path)
    return entry.name === ".DS_Store" ? [] : [relative(root, path).split(sep).join("/")]
  })

beforeAll(() => {
  if (process.env.PACK_TARBALL) {
    tarball = resolve(process.env.PACK_TARBALL)
  } else {
    // Build explicitly: the package has no prepare or prepack script, and npm would run one even with --ignore-scripts.
    run("npm", ["run", "build"], REPO)
    packed = (JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], REPO)) as NonNullable<typeof packed>[])[0]!
    tarball = join(work, packed.filename)
  }
  installed = join(install("alone"), "node_modules", ...pkg.name.split("/"))
})

beforeAll(async () => {
  fake = await startFakePlaud()
})

afterAll(async () => {
  await fake?.close()
  rmSync(work, { recursive: true, force: true })
})

describe("the tarball", () => {
  it("holds exactly the files whitelist: built JavaScript, skills and the user docs, under 1 MB", () => {
    const files = tree(installed).sort()
    const expected = [
      "package.json",
      ...pkg.files.flatMap((entry) => (statSync(join(REPO, entry)).isDirectory() ? tree(join(REPO, entry)).map((path) => `${entry}/${path}`) : [entry])),
    ].sort()
    expect(files).toEqual(expected)
    expect(files.filter((path) => /\.(?:tsx|jsx|map|ts)$|(?:^|\/)node_modules\//.test(path))).toEqual([])
    expect([...new Set(files.filter((path) => path.startsWith("skills/")).map((path) => path.split("/")[1]))].sort()).toEqual(SKILLS)
    expect(files.length).toBeLessThan(150)
    expect(statSync(tarball).size).toBeLessThan(1024 * 1024)
    if (packed) expect(packed.files.map((file) => file.path).sort()).toEqual(files)
  })

  it("declares no dependencies, peers or install scripts, and states the tested OpenCode line", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Record<string, unknown>
    for (const field of UNDECLARED) expect(manifest[field], field).toBeUndefined()
    expect(Object.keys((manifest.scripts as Record<string, string> | undefined) ?? {}).filter((name) => LIFECYCLE.includes(name))).toEqual([])
    expect(manifest.opencode).toEqual({ host: TESTED_HOST })
    expect(manifest.exports).toEqual({ ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    for (const target of Object.values(pkg.exports)) expect(existsSync(join(installed, target)), target).toBe(true)
  })

  it("installs alone: nothing comes with it", () => {
    const modules = join(dirname(dirname(installed)))
    const names = readdirSync(modules, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .flatMap((entry) => (entry.name.startsWith("@") ? readdirSync(join(modules, entry.name)).map((name) => `${entry.name}/${name}`) : [entry.name]))
    expect(names).toEqual([pkg.name])
  })

  // OpenCode reloads a plugin in place and keeps the modules it already loaded for unchanged paths. A sibling
  // module could then be a stale copy, so each entry the host loads is one file that loads nothing relative.
  it("ships exactly two self-contained entries: dist/index.js and dist/tui.js, with no relative, dynamic or required module", () => {
    const dist = join(installed, "dist")
    expect(tree(dist).sort()).toEqual(["index.js", "tui.js"])
    for (const entry of ["index.js", "tui.js"]) {
      const loads = moduleSpecifiers(readFileSync(join(dist, entry), "utf8"), entry)
      expect(loads.filter((specifier) => /^[./]|^#computed-module$/.test(specifier)), entry).toEqual([])
      const code = readFileSync(join(dist, entry), "utf8")
      expect(/\bimport\s*\(|\brequire\s*\(/.test(code), `${entry} has a dynamic import or require`).toBe(false)
    }
  })

  it("keeps zod out of the TUI part, which stays under 30 KB", () => {
    const tui = join(installed, "dist", "tui.js")
    expect(statSync(tui).size).toBeLessThan(30_000)
    expect(readFileSync(tui, "utf8")).not.toMatch(/zod|node_modules\//i)
  })

  it("loads only modules OpenCode provides, and uses no forbidden host API", () => {
    const dist = join(installed, "dist")
    const foreign = (entry: string, allowed: RegExp[]) => {
      const seen = new Set<string>()
      const found = new Set<string>()
      for (const queue = [entry]; queue.length > 0; ) {
        const file = queue.pop()!
        if (seen.has(file)) continue
        seen.add(file)
        for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"), file)) {
          if (specifier.startsWith(".")) {
            const target = resolve(dirname(file), specifier)
            if (target.startsWith(dist + sep)) queue.push(target)
            else found.add(`${specifier} (outside dist/)`)
          } else if (!allowed.some((pattern) => pattern.test(specifier))) {
            found.add(specifier)
          }
        }
      }
      return [...found]
    }
    expect(foreign(join(dist, "index.js"), SERVER_MODULES)).toEqual([])
    expect(foreign(join(dist, "tui.js"), TUI_MODULES)).toEqual([])
    const scripts = tree(dist).filter((path) => path.endsWith(".js"))
    expect(scripts.flatMap((path) => forbiddenUses(readFileSync(join(dist, path), "utf8"), path, "shipped").map((problem) => `dist/${path}:${problem}`))).toEqual([])
  })
})

/** The stock CLI: OPENCODE_BIN_<version> if set, otherwise the unmodified npm release installed with scripts off. */
function stockBinary(version: string): string {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  const dir = project(`opencode-${version}`)
  run("npm", ["install", `@opencode/cli@${version}`, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  const path = join(dir, "node_modules", "@opencode", `cli-${platform()}-${arch()}`, "bin", "opencode")
  if (!existsSync(path)) throw new Error(`@opencode/cli@${version} has no binary for ${platform()}-${arch()}`)
  return path
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/**
 * `opencode serve` on its own port, with an environment that holds only its temp root, and a project that loads the
 * installed package with its url option on the loopback fake.
 */
async function serve(version: string) {
  const binary = stockBinary(version)
  const root = join(work, `host-${version}`)
  const home = join(root, "home")
  const directory = join(root, "project")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(root, "tmp"),
  }
  for (const dir of [...Object.values(env), directory]) mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(directory, "opencode.json"),
    JSON.stringify({ plugins: [{ package: installed, options: { url: fake.url, exportRoots: [join(root, "exports")] } }] }, null, 2),
  )
  const password = randomUUID()
  const full = { ...env, ...OFFLINE, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }

  expect(run(binary, ["--version"], root, full).trim()).toBe(`opencode v${version}`)
  // OpenCode resolves every global path from this environment; none may leave the temp root.
  const paths = run(binary, ["debug", "paths"], root, full).trim().split("\n").map((line) => line.trim().split(/\s+/))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(([, path]) => !path?.startsWith(`${root}/`))).toEqual([])

  const port = await freePort()
  let output = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env: full, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (output += chunk))
  server.stderr.on("data", (chunk) => void (output += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const api = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
    return text === "" ? undefined : JSON.parse(text)
  }
  /** Polls until `read` returns a value: plugins activate after the server answers. */
  const until = async <T>(what: string, read: () => Promise<T | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await sleep(500)) {
      const value = await read().catch((error: unknown) => (Date.now() > deadline ? Promise.reject(error) : undefined))
      if (value !== undefined) return value
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`opencode ${version}: ${what} did not happen\n${output.slice(-3000)}`)
    }
  }
  const close = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM")
      const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
      await exited
      clearTimeout(timer)
    }
  }
  return { api, until, close, log: () => output }
}

describe.each(HOST_VERSIONS)("installed alone, in stock OpenCode %s", (version) => {
  it("is active with its server and TUI parts, answers the status RPC, signs in to the fake, and registers /plaud-status and the skills", async () => {
    const host = await serve(version)
    try {
      const plugin = await host.until("plugin activation", async () => {
        const found = ((await host.api("GET", "/api/plugin")) as { data: { id: string; state: { status: string } }[] }).data.find(
          (entry) => entry.id === "plaud.recordings",
        )
        return found && found.state.status !== "loading" ? found : undefined
      })
      expect(plugin).toMatchObject({ state: { status: "active" }, features: { server: true, tui: true } })

      const status = await host.until("the plaud server to sign in", async () => {
        const { output } = (await host.api("POST", "/api/rpc/plaud.recordings/status", { input: {} })) as { output: { accounts: { state: string }[] } }
        return output.accounts[0]?.state === "signed_in" ? output : undefined
      })
      expect(status).toMatchObject({
        accounts: [{ account: "default", server: "plaud", state: "signed_in" }],
        host: { version, tested: true },
        unguardedAgents: [],
        nextStep: "Nothing to do.",
      })

      // /connect lists integrations from this endpoint; the plaud server's shows under the brand.
      const { data: servers } = (await host.api("GET", "/api/mcp")) as { data: { name: string; integrationID?: string }[] }
      const integrationID = servers.find((server) => server.name === "plaud")?.integrationID
      expect(integrationID).toMatch(/^mcp_/)
      await host.until("the /connect name", async () => {
        const { data } = (await host.api("GET", "/api/integration")) as { data: { id: string; name: string }[] }
        return data.find((item) => item.id === integrationID)?.name === "Plaud" ? true : undefined
      })

      const commands = ((await host.api("GET", "/api/command")) as { data: { name: string }[] }).data.map((command) => command.name)
      expect(commands.filter((name) => name.startsWith("plaud"))).toEqual(["plaud-status"])
      const skills = await host.until("the skills", async () => {
        const list = ((await host.api("GET", "/api/skill")) as { data: { id: string; path: string }[] }).data.filter((skill) => skill.id.startsWith("opencode-plaud"))
        return list.length === SKILLS.length ? list : undefined
      })
      expect(skills.map((skill) => skill.id).sort()).toEqual(SKILLS)
      for (const skill of skills) expect(skill.path).toBe(join(installed, "skills", skill.id, "SKILL.md"))
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
    }
  })
})

it("imports '.' and './tui' under Bun, next to the host packages at their development versions", () => {
  const dir = install(
    "with-host",
    HOST_PACKAGES.map((name) => `${name}@${pkg.devDependencies[name]}`),
  )
  writeFileSync(
    join(dir, "probe.mjs"),
    [
      `const server = (await import(${JSON.stringify(pkg.name)})).default`,
      `const tui = (await import(${JSON.stringify(`${pkg.name}/tui`)})).default`,
      "console.log(JSON.stringify({",
      "  server: { id: server.id, setup: typeof server.setup },",
      "  tui: { id: tui.id, setup: typeof tui.setup },",
      "}))",
    ].join("\n"),
  )
  const output = run("bun", ["probe.mjs"], dir)
  expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
    server: { id: "plaud.recordings", setup: "function" },
    tui: { id: "plaud.recordings.tui", setup: "function" },
  })
})
