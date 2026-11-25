import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCodeClient } from "@opencode/client"
import { startFakePlaud, type FakePlaud } from "../fixtures/fake-plaud.js"
import { createProbe } from "./probe.js"
import { network, WORKER_ROOT } from "./setup.js"

/**
 * The plugin inside a real OpenCode host: the public `@opencode/sdk` assembles the OpenCode server in this process and
 * answers client calls in memory, with no listener and no CLI. The plugin loads the way a user loads it, from a config
 * `plugins` entry pointing at this repository's built package, with its `url` option on a loopback fake Plaud.
 *
 * No real model is configured. Tools run through their host executors with a real session context (the probe plugin),
 * or through Code Mode as an automation's code action, which runs the host's own tool path and hooks.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, "../..")
export const PLUGIN_ID = "plaud"

type Sdk = typeof import("@opencode/sdk")
/** The embedded host's client surface. The SDK's own interface loses most of its types to internal declarations. */
export type Host = OpenCodeClient & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  close(): Promise<void>
}
type PluginEntry = Awaited<ReturnType<Host["plugin"]["list"]>>["data"][number]
type ProbeContext = ReturnType<ReturnType<typeof createProbe>["context"]>
type Tools = Awaited<ReturnType<ProbeContext["tool"]["list"]>>
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
  /** Extra test plugins beside the probe, such as a policy plugin. */
  readonly plugins?: readonly import("@opencode/plugin").Plugin.Plugin[]
  /** Runs after the host folders exist, before the plugin starts; its result overrides plugin options. */
  readonly prepare?: (paths: { readonly root: string; readonly work: string; readonly exportRoot: string }) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
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
  tools(): Promise<Tools>
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

/** The locked SDK, its version, and its folder. */
async function loadSdk(): Promise<{ sdk: Sdk; version: string; root: string }> {
  const root = join(REPO, "node_modules", "@opencode", "sdk")
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; exports: { ".": { import: string } } }
  const sdk = (await import(pathToFileURL(join(root, manifest.exports["."].import)).href)) as Sdk
  return { sdk, version: manifest.version, root }
}

type Embedded = Awaited<ReturnType<Sdk["OpenCode"]["create"]>>

/**
 * The SDK's host, with its own Automation service also running the scheduler, as `opencode serve` does (only a server
 * process starts it): `PromiseSdk.create` is what `OpenCode.create` calls, here with the SDK's `overrides`.
 */
async function createSdk(root: string, options: Parameters<Sdk["OpenCode"]["create"]>[0]): Promise<Embedded> {
  const load = (...path: string[]) => import(pathToFileURL(join(...path)).href)
  const modules = join(root, "..", "..")
  const { PromiseSdk } = await load(root, "dist", "promise.js")
  const { Automation } = await load(modules, "@opencode", "core", "dist", "automation.js")
  const { Effect, Layer } = await load(modules, "effect", "dist", "index.js")
  const scheduling = Automation.node.mapLayer((layer: unknown) =>
    Layer.effect(
      Automation.Service,
      Effect.gen(function* () {
        const automations = yield* Automation.Service
        yield* Effect.forkScoped(automations.run)
        return automations
      }),
    ).pipe(Layer.provide(layer)),
  )
  return PromiseSdk.create(options, { overrides: [Automation.node.replace(scheduling)] })
}

/** How OpenCode answered a program run with nobody present: it ran and returned, or its message. */
type Unattended = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** The part of the `experimental.automation` client used here. */
interface Automations {
  create(input: { sessionID: string; name: string; trigger: { type: "at"; at: string }; action: { type: "code"; code: string } }): Promise<{ id: string }>
  get(input: { automationID: string }): Promise<{ lastOutcome?: string; lastOutput?: string }>
  delete(input: { automationID: string }): Promise<unknown>
}

/** A schedule check returned a boolean or `{ wake }`; an automation returns nothing, so the program is wrapped. */
const asCheck = (code: string) =>
  `const checked = await (async () => {\n${code}\n})()\nif (typeof checked !== "boolean" && !(typeof checked === "object" && checked !== null && typeof checked.wake === "boolean")) throw new Error("A code check must return a boolean or { wake, state?, message? }")`

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export async function startHost(input: HostOptions = {}): Promise<Harness> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(`the host suite needs Node 24 or later, not ${process.version}`)
  const { version: sdkVersion, root: sdkRoot } = await loadSdk()
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plaud-host-")))
  const work = join(root, "work")
  const exportRoot = join(root, "exports")
  mkdirSync(work)
  mkdirSync(join(root, "config"))
  const prepared = (await input.prepare?.({ root, work, exportRoot })) ?? {}

  const fake = await startFakePlaud()
  const revoke = network.allow(fake.origin)
  const deniedBefore = network.denied.length
  const probe = createProbe()
  const config = {
    plugins: [{ package: REPO, options: { url: fake.url, exportRoots: [exportRoot], ...input.options, ...prepared } }],
    experimental: { automations: true },
    // No model is used. An empty base URL stops the host probing local model servers on loopback ports.
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...(typeof input.config === "function" ? input.config(fake) : input.config),
  }

  let opencode: Host
  try {
    opencode = (await createSdk(sdkRoot, {
      plugins: [probe.plugin, ...(input.plugins ?? [])],
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

  /** Runs a Code Mode program once with nobody present to answer a prompt, as a schedule check. */
  const unattended = async (sessionID: string, code: string): Promise<Unattended> => {
    const name = "plaud-host-test"
    const refused = (error: unknown): Unattended => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
    const client = (opencode.experimental as unknown as { automation: Automations }).automation
    let automationID: string
    try {
      automationID = (await client.create({ sessionID, name, trigger: { type: "at", at: "in 1 millis" }, action: { type: "code", code: asCheck(code) } })).id
    } catch (error) {
      return refused(error)
    }
    try {
      const run = await until(
        "the automation's code action has run",
        async () => {
          const info = await client.get({ automationID })
          return info.lastOutcome === undefined ? undefined : info
        },
        60_000,
      )
      if (run.lastOutcome === "fired" || run.lastOutcome === "late") return { ok: true }
      if (run.lastOutcome === "failed") return { ok: false, error: (run.lastOutput ?? "").replace(/^Paused: /, "") }
      throw new Error(`the automation's code action ended "${run.lastOutcome}": ${run.lastOutput ?? ""}`)
    } finally {
      await client.delete({ automationID })
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
      }
      try {
        return { ok: true, result: await found.execute(value as never, context as never) }
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
      const outcome = await unattended(sessionID, code)
      if (outcome.ok) throw new Error("the Code Mode program did not throw, so a schedule was created")
      return `${outcome.error} `
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
