import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCodeClient } from "@opencode/client"
import { startFakePlaud, type FakePlaud } from "../fixtures/fake-plaud.js"
import { createProbe } from "./probe.js"
import { network, WORKER_ROOT } from "./setup.js"

/**
 * The plugin inside a real OpenCode host: the public `@opencode/sdk`
 * assembles the OpenCode server in this process and answers client calls
 * in memory, with no listener and no CLI. The plugin loads the way a user
 * loads it, from a config `plugins` entry pointing at this repository's
 * built package, with its `url` option on a loopback fake Plaud.
 *
 * No real model is configured. Tools run through their host executors with
 * a real session context (the probe plugin), through Code Mode in a schedule
 * check, which runs the host's own tool path and hooks, or in a session turn
 * of the fake's scripted loopback model (`model.test.ts`).
 *
 * The SDK is the root dev dependency `@opencode/sdk` (2.2.3), or the one
 * installed under `HOST_SDK_DIR` to test another release.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, "../..")
export const PLUGIN_ID = "plaud.recordings"

type Sdk = typeof import("@opencode/sdk")
/**
 * The embedded host's client surface. The SDK's own `OpenCode.Interface`
 * loses most of its types to the host's internal declarations; the generated
 * client types are the same contract.
 */
export type Host = OpenCodeClient & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  close(): Promise<void>
}
type PluginEntry = Awaited<ReturnType<Host["plugin"]["list"]>>["data"][number]
type ToolContext = Parameters<Awaited<ReturnType<ReturnType<ReturnType<typeof createProbe>["context"]>["tool"]["list"]>>[number]["execute"]>[1]
interface HostEvent {
  readonly type: string
  readonly data?: Record<string, unknown>
}

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

interface HostOptions {
  /** Plugin options. `url` defaults to the fake's signed-in endpoint and `exportRoots` to a fresh folder. */
  readonly options?: Record<string, unknown>
  /** Other opencode.json keys, such as `permissions`, `agents` and `mcp`; a function receives the fake's URLs. */
  readonly config?: Record<string, unknown> | ((fake: FakePlaud) => Record<string, unknown>)
  /** What the host reports as `ctx.app.version`; the SDK's own version by default. */
  readonly version?: string
}

/** A tool call's outcome as the calling tool sees it. */
type Outcome = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string }

export interface Harness {
  readonly opencode: Host
  readonly fake: FakePlaud
  readonly location: { readonly directory: string }
  /** The SDK release under test. */
  readonly sdkVersion: string
  readonly exportRoot: string
  readonly events: HostEvent[]
  /** The plugin's entry in the host's plugin list once it stopped loading. */
  readonly plugin: PluginEntry
  /** Every tool the host has registered at the location, with its executor. */
  tools(): ReturnType<ReturnType<ReturnType<typeof createProbe>["context"]>["tool"]["list"]>
  probe(): ReturnType<ReturnType<typeof createProbe>["context"]>
  session(agent?: string): Promise<string>
  /** Runs a registered tool's host executor with a session context, as the host would. */
  call(sessionID: string, tool: string, input: unknown, agent?: string): Promise<Outcome>
  /** The next pending permission request of a session. */
  asked(sessionID: string): Promise<{ id: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown> }>
  /** No permission request is pending in the session. */
  pending(sessionID: string): Promise<number>
  /** The host's decision for a request, with the same evaluation `assert` uses. An `ask` stays pending until replied. */
  evaluate(sessionID: string, agent: string, action: string, resource: string, save?: string[]): Promise<{ id: string; effect: string }>
  /** Runs a Code Mode program once on the host's tool path (a schedule check). It must throw; returns the message. */
  codemode(sessionID: string, code: string): Promise<string>
  /** Resolves once `read` returns a value. */
  until<T>(what: string, read: () => Promise<T | undefined>, ms?: number): Promise<T>
  close(): Promise<void>
}

/** The SDK under test and its version. */
async function loadSdk(): Promise<{ sdk: Sdk; version: string }> {
  const base = process.env.HOST_SDK_DIR ? resolve(process.env.HOST_SDK_DIR) : REPO
  const root = join(base, "node_modules", "@opencode", "sdk")
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; exports: { ".": { import: string } } }
  const sdk = (await import(pathToFileURL(join(root, manifest.exports["."].import)).href)) as Sdk
  return { sdk, version: manifest.version }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export async function startHost(input: HostOptions = {}): Promise<Harness> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(`the host suite needs Node 24 or later, not ${process.version}`)
  const { sdk, version: sdkVersion } = await loadSdk()
  const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-plaud-host-")))
  const work = join(root, "work")
  const exportRoot = join(root, "exports")
  mkdirSync(work)
  mkdirSync(join(root, "config"))

  const fake = await startFakePlaud()
  const revoke = network.allow(fake.origin)
  const deniedBefore = network.denied.length
  const probe = createProbe()
  const config = {
    plugins: [{ package: REPO, options: { url: fake.url, exportRoots: [exportRoot], ...input.options } }],
    experimental: { schedules: true },
    // No model is used. An empty base URL stops the host probing local model servers on loopback ports.
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...(typeof input.config === "function" ? input.config(fake) : input.config),
  }

  let opencode: Host
  try {
    opencode = (await sdk.OpenCode.create({
      plugins: [probe.plugin],
      // An embedded host reports "unknown" unless told, and the plugin refuses an untested host.
      app: { version: input.version ?? sdkVersion },
      config: { content: JSON.stringify(config), directory: join(root, "config"), project: false, claude: false },
      database: { path: join(root, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
      log: { level: "error", emit: () => undefined },
    })) as unknown as Host
  } catch (error) {
    await fake.close()
    revoke()
    rmSync(root, { recursive: true, force: true })
    throw error
  }

  const events: HostEvent[] = []
  const stream = new AbortController()
  const subscribed = (async () => {
    try {
      for await (const event of opencode.events.subscribe({ signal: stream.signal } as never)) events.push(event as unknown as HostEvent)
    } catch {
      // The stream ends when the host closes.
    }
  })()
  const location = { directory: work }

  const until = async <T>(what: string, read: () => Promise<T | undefined>, ms = 60_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await sleep(100)) {
      const value = await read()
      if (value !== undefined) return value
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    }
  }

  let seq = 0
  const harness: Omit<Harness, "plugin"> = {
    opencode,
    fake,
    location,
    sdkVersion,
    exportRoot,
    events,
    until,
    tools: () => probe.context(work).tool.list(),
    probe: () => probe.context(work),
    session: async (agent = "build") => (await opencode.sessions.create({ agent, location })).id,
    call: async (sessionID, tool, value, agent = "build") => {
      const found = (await harness.tools()).find((item) => item.id === tool)
      if (!found) throw new Error(`the host has no tool ${tool}`)
      seq += 1
      const context = {
        sessionID,
        agent,
        messageID: `msg_host${String(seq).padStart(4, "0")}`,
        id: `call_host_${seq}`,
        signal: new AbortController().signal,
        progress: async () => undefined,
      } as unknown as ToolContext
      try {
        return { ok: true, result: await found.execute(value as never, context) }
      } catch (error) {
        const inner = (error as { error?: unknown }).error
        const message = [error instanceof Error ? error.message : String(error), inner instanceof Error ? inner.message : ""].filter(Boolean)
        return { ok: false, error: `${(error as Error).name ?? "Error"}: ${message.join(" / ")}` }
      }
    },
    asked: (sessionID) =>
      until(`a permission request in ${sessionID}`, async () => {
        const [request] = await opencode.permission.list({ sessionID })
        return request as Awaited<ReturnType<Harness["asked"]>> | undefined
      }),
    pending: async (sessionID) => (await opencode.permission.list({ sessionID })).length,
    evaluate: (sessionID, agent, action, resource, save) =>
      opencode.permission.create({ sessionID, agent, action, resources: [resource], ...(save ? { save } : {}) }),
    codemode: async (sessionID, code) => {
      try {
        await opencode.experimental.schedule.create({ sessionID, when: { in: "6 hours" }, if: { code }, prompt: "unused" })
      } catch (error) {
        return error instanceof Error ? `${error.message} ${String((error as { detail?: unknown }).detail ?? "")}` : String(error)
      }
      throw new Error("the Code Mode program did not throw, so a schedule was created")
    },
    close: async () => {
      stream.abort()
      try {
        await opencode.close()
        await subscribed
      } finally {
        await fake.close()
        revoke()
        rmSync(root, { recursive: true, force: true })
      }
      const denied = network.denied.slice(deniedBefore)
      if (denied.length > 0) throw new Error(`the host tried to reach ${[...new Set(denied)].join(", ")}, not only the fake`)
    },
  }

  try {
    // Isolation: the host's global folders, created at start, and its temp directory are in the worker's root.
    // Its config folder is the `config.directory` above.
    const inside = (path: string) => path.startsWith(`${WORKER_ROOT}/`)
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key] ?? "", "opencode"))
    const { paths } = await opencode.server.info()
    const outside = [...global.filter((path) => !inside(path) || !existsSync(path)), ...(inside(realpathSync(paths.tmp)) ? [] : [paths.tmp])]
    if (outside.length > 0) throw new Error(`OpenCode's global paths are not all inside ${WORKER_ROOT}: ${outside.join(", ")}`)

    // The first host in a worker also boots the SDK and every built-in plugin, which is slow on a loaded machine.
    const plugin = await until(
      `${PLUGIN_ID} to finish loading`,
      async () => {
        const { data } = await opencode.plugin.list({ location })
        const entry = data.find((item) => item.id === PLUGIN_ID)
        return entry && (entry.state as { status: string }).status !== "loading" ? entry : undefined
      },
      150_000,
    )
    return { ...harness, plugin }
  } catch (error) {
    await harness.close()
    throw error
  }
}
