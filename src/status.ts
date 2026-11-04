import { displayName, signInStep } from "./domain/auth.js"
import { scrubUrls } from "./domain/redact.js"
import type { PluginContext } from "./host/context.js"
import { KNOWN_READS, type PlaudServers } from "./host/mcp.js"
import { defaultRules, EXPORT_ACTION, unguardedAgents, type Rule } from "./host/permissions.js"
import { READY_STEP, SHARED_STATE, STATE_TEXT, overallState, statusLines, type AccountState, type AccountStatus, type Status } from "./rpc.js"
import { PLUGIN_VERSION, TESTED_HOSTS, type HostCheck } from "./version.js"

/**
 * The status model behind `/plaud-status`, the RPC `status` method and the
 * TUI view. It is built only from public host APIs and the plugin's own
 * setup: OpenCode's MCP server list, its tool list, the agents' permission
 * rules, the host check and the options. It never reads or shows a token.
 */

type McpServerInfo = Awaited<ReturnType<PluginContext["mcp"]["list"]>>["data"][number]

export interface StatusFacts {
  readonly host: HostCheck
  /** The plugin's servers, the default account first, and the names another definition already held. */
  readonly servers: readonly { readonly account: string; readonly name: string }[]
  readonly inUse: readonly string[]
  readonly exportRoots: readonly string[]
  /** OpenCode's MCP server list. */
  readonly mcp: readonly McpServerInfo[]
  /** The IDs of every tool OpenCode has registered, such as `plaud_get_file`. */
  readonly tools: readonly string[]
  readonly agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
}

const STATE: Record<McpServerInfo["status"]["status"], AccountState> = {
  connected: "signed_in",
  needs_auth: "sign_in_needed",
  pending: "connecting",
  failed: "failed",
  disabled: "disabled",
}

/** Unknown tool names are upstream text: only plain names are listed, and at most this many. */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/
const LISTED_UNKNOWN = 10

/** The Plaud servers' tools, known or not, and plaud_export. */
function countTools(servers: StatusFacts["servers"], ids: readonly string[]): Status["tools"] {
  const known = new Set<string>(KNOWN_READS)
  let visible = ids.includes(EXPORT_ACTION) ? 1 : 0
  const unknown = new Set<string>()
  let count = 0
  for (const server of servers) {
    const prefix = `${server.name}_`
    for (const id of ids) {
      if (!id.startsWith(prefix) || id === EXPORT_ACTION) continue
      const name = id.slice(prefix.length)
      if (known.has(name)) visible++
      else {
        count++
        unknown.add(name)
      }
    }
  }
  return { visible, unknown: count, unknownNames: [...unknown].filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN) }
}

/** OpenCode's error text can name the server's URL; it is shortened, and links and bearer credentials are withheld. */
function reason(error: string): string {
  const text = scrubUrls(error).replace(/\bBearer\s+\S+/gi, "Bearer [withheld]").replace(/\s+/g, " ").trim()
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

function accountStep(account: AccountStatus): string | undefined {
  const server = account.server
  switch (account.state) {
    case "signed_in":
      return undefined
    case "sign_in_needed":
      return signInStep(account.account)
    case "connecting":
      return `Wait a few seconds while OpenCode connects to ${server}, then check again.`
    case "failed":
      return `Check your network connection, then reconnect ${server} in /mcps. If it keeps failing, run opencode mcp logout ${server}, then run /connect and choose ${displayName(account.account)} to sign in again.`
    case "disabled":
      return `Enable ${server} in /mcps.`
    case "missing":
      return `OpenCode has not listed the ${server} server yet. Check again in a few seconds; if it is still missing, open /plugins and check plaud.recordings.`
  }
}

/**
 * Agents defined only in the user's config are created after plugins run,
 * so they miss the default rules. The fix goes in each such agent's own
 * permissions, never the top-level ones: those also come after Explore's own
 * `* * deny` and would loosen it.
 */
export function agentsFix(agents: readonly string[]): string {
  const list = agents.join(", ")
  return (
    `Put the block first in the own permissions of ${list} (agents.<id>.permissions in opencode.json, or the agent file's frontmatter), ` +
    "followed by your top-level rules for Plaud's actions. " +
    "OpenCode adds agents defined in your config after plugins load, so they miss the default rules. " +
    "Don't add the block to the top-level permissions: that would loosen stricter agents such as Explore."
  )
}

/** The tested releases in words: "2.2.3, 2.2.4 or 2.2.5". */
const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`

export function buildStatus(facts: StatusFacts): Status {
  const accounts = facts.servers.map((server): AccountStatus => {
    const listed = facts.mcp.find((entry) => entry.name === server.name)
    const state = listed === undefined ? "missing" : STATE[listed.status.status]
    const error = listed?.status.status === "failed" ? listed.status.error : undefined
    return {
      account: server.account,
      server: server.name,
      state,
      ...(error ? { reason: reason(error) } : {}),
      ...(facts.inUse.includes(server.name) ? { userServer: true } : {}),
    }
  })
  const block = defaultRules(facts.servers.map((server) => server.name))
  const unguarded = unguardedAgents(facts.agents, block)
  const nextStep = accounts.map(accountStep).find((step) => step !== undefined)
    ?? (unguarded.length === 0 ? undefined : agentsFix(unguarded))
    // A release inside the range sets up normally, tested or not; only one outside it, loaded with allowUntestedHost, adds a step.
    ?? (facts.host.inRange ? READY_STEP : `If Plaud misbehaves, use a tested OpenCode release: ${TESTED_TEXT}.`)
  const status = {
    version: PLUGIN_VERSION,
    accounts,
    exportRoots: [...facts.exportRoots],
    tools: countTools(facts.servers, facts.tools),
    host: { version: facts.host.version === "" ? null : facts.host.version, range: facts.host.range, tested: facts.host.tested },
    unguardedAgents: unguarded,
    permissionsBlock: block,
    nextStep,
  }
  return { ...status, state: SHARED_STATE[overallState(status)] }
}

export interface StatusSources {
  readonly host: HostCheck
  readonly servers: Pick<PlaudServers, "list" | "inUse">
  readonly exportRoots: readonly string[]
}

export type StatusHost = {
  readonly mcp: Pick<PluginContext["mcp"], "list">
  readonly tool: Pick<PluginContext["tool"], "list">
  readonly agent: Pick<PluginContext["agent"], "list">
}

export async function readStatus(ctx: StatusHost, sources: StatusSources): Promise<Status> {
  const [mcp, tools, agents] = await Promise.all([ctx.mcp.list(), ctx.tool.list(), ctx.agent.list()])
  return buildStatus({
    host: sources.host,
    servers: sources.servers.list,
    inUse: sources.servers.inUse(),
    exportRoots: sources.exportRoots,
    mcp: mcp.data,
    tools: tools.map((tool) => tool.id),
    agents: agents.data,
  })
}

/** The one-line summary, such as "Plaud: sign-in required". */
export function summarizeStatus(status: Status): string {
  return `Plaud: ${STATE_TEXT[overallState(status)]}`
}

/** `/plaud-status` text: the same lines as the TUI dialog, under the same title, with the rules as JSON to copy. */
export function formatStatus(status: Status): string {
  return [
    "**Plaud status**",
    "",
    ...statusLines(status).flatMap((line) => [
      `- ${line.label}: ${line.value}`,
      ...(line.block === undefined ? [] : ["", "```json", line.block, "```", ""]),
    ]),
  ].join("\n")
}

/** What a status view shows when the status cannot be read. */
export function statusUnavailable(error: unknown): { message: string; nextStep: string } {
  const detail = error instanceof Error ? error.message : String(error)
  return {
    message: `STATUS_UNAVAILABLE: Plaud's status could not be read (${reason(detail)}).`,
    nextStep: "Try again in a few seconds. If it keeps failing, restart OpenCode and open /plugins to check plaud.recordings.",
  }
}
