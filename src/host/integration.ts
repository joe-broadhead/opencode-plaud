import { DISPLAY_NAME, displayName } from "../domain/auth.js"
import type { PluginContext, Registration } from "./context.js"
import type { McpServer } from "./mcp.js"

/**
 * Names each account's `/connect` entry: "Plaud" for the `plaud` server and
 * "Plaud (<alias>)" for `plaud-<alias>`, and marks a signed-in account
 * "Sign in required" there while its server needs a new sign-in. OpenCode
 * makes every remote MCP server an integration named after the server. It
 * registers that integration after plugin setup, and again under the server
 * name whenever the MCP config reloads, so the rename is registered once the
 * integrations exist, and again each time the host's name comes back.
 * Events trigger a check; the first seconds are also polled, because a
 * subscription has no start acknowledgement.
 */

/** What `/connect` shows on an account while its server needs a new sign-in. */
export const SIGN_IN_AGAIN = `${DISPLAY_NAME} needs a new sign-in. Choose this account, then press o or Enter to open the sign-in page.`

export type IntegrationHost = {
  readonly mcp: Pick<PluginContext["mcp"], "list">
  readonly integration: Pick<PluginContext["integration"], "transform" | "get" | "connection">
  readonly event: Pick<PluginContext["event"], "subscribe">
}

const STARTUP_POLL_MS = 250
const STARTUP_WINDOW_MS = 10_000
const RESUBSCRIBE_MS = 5_000

export function nameIntegrations(ctx: IntegrationHost, servers: readonly McpServer[]): Registration {
  const stopped = new AbortController()
  let registration: Registration | undefined

  const sync = async () => {
    const { data } = await ctx.mcp.list()
    const names = new Map<string, string>()
    const states = new Map<string, string>()
    for (const server of servers) {
      const entry = data.find((item) => item.name === server.name)
      if (entry?.integrationID === undefined) continue
      names.set(entry.integrationID, displayName(server.account))
      states.set(entry.integrationID, entry.status.status)
    }
    const current = await Promise.all([...names].map(async ([id, name]) => (await ctx.integration.get({ integrationID: id })).data.name === name))
    if (!current.every(Boolean) && !stopped.signal.aborted) {
      const previous = registration
      registration = await ctx.integration.transform((editor) => {
        for (const [id, name] of names) if (editor.get(id)) editor.update(id, (integration) => void (integration.name = name))
      })
      await previous?.dispose()
    }
    for (const [id, state] of states) {
      if (stopped.signal.aborted) return
      const connection = await ctx.integration.connection.active(id)
      if (connection?.type !== "credential") continue
      const reported = connection.status?.message === SIGN_IN_AGAIN
      if (state === "needs_auth" && !connection.status) {
        await ctx.integration.connection.status({ integrationID: id, connection, status: { status: "needs_auth", message: SIGN_IN_AGAIN } })
      } else if (state === "connected" && reported) {
        await ctx.integration.connection.status({ integrationID: id, connection, status: undefined })
      }
    }
  }

  // One check at a time; triggers that arrive meanwhile cause one more check after it.
  let running: Promise<void> | undefined
  let again = false
  const schedule = () => {
    if (running) return void (again = true)
    running = (async () => {
      do {
        again = false
        if (!stopped.signal.aborted) await sync().catch(() => undefined)
      } while (again)
    })().finally(() => (running = undefined))
  }

  void (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["integration.updated", "mcp.status.changed", "credential.updated", "credential.switched"], signal: stopped.signal })
        for await (const event of events) {
          if (event.type !== "mcp.status.changed" || servers.some((server) => server.name === event.data.server)) schedule()
        }
      } catch {
        // The stream failed; check, then subscribe again.
      }
      if (!stopped.signal.aborted) schedule()
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()
  const startup = (async () => {
    for (const until = Date.now() + STARTUP_WINDOW_MS; Date.now() < until && !stopped.signal.aborted; ) {
      schedule()
      await delay(STARTUP_POLL_MS, stopped.signal)
    }
  })()

  return {
    dispose: async () => {
      stopped.abort()
      await startup
      await running
      await registration?.dispose()
      registration = undefined
    },
  }
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
