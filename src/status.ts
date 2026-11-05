import { displayName, signInStep } from "./domain/auth.js"
import { scrubUrls } from "./domain/redact.js"
import type { PluginContext } from "./host/context.js"
import { shadowedSkills, type ListedSkill } from "./host/skills.js"
import { KNOWN_READS, type PlaudServers } from "./host/mcp.js"
import { defaultRules, OWN_TOOLS, unguardedAgents, type Rule } from "./host/permissions.js"
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
  /** OpenCode's skill list, and the plugin's own skills with the paths it gave them. */
  readonly skills: readonly ListedSkill[]
  readonly ownSkills: readonly ListedSkill[]
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

/** The Plaud servers' tools, known or not, and the plugin's own, plaud_export and plaud_recent. */
function countTools(servers: StatusFacts["servers"], ids: readonly string[]): Status["tools"] {
  const known = new Set<string>(KNOWN_READS)
  let visible = OWN_TOOLS.filter((tool) => ids.includes(tool)).length
  const unknown = new Set<string>()
  let count = 0
  for (const server of servers) {
    const prefix = `${server.name}_`
    for (const id of ids) {
      if (!id.startsWith(prefix) || OWN_TOOLS.includes(id)) continue
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
 * The fix for agents defined only in the user's config, which OpenCode creates
 * after plugins run, so they miss the default rules: the family's one sentence,
 * with no agent names (the Agents row lists them). Why the rules go in each
 * agent's own permissions, not the top-level ones, is in docs/configuration.md.
 */
export const AGENTS_STEP =
  "Put the default rules shown by /plaud-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Plaud tools."

/** A user's or a project's skill with a plugin skill's id wins in OpenCode, so the plugin's never loads. */
function shadowStep(skill: ListedSkill): string {
  return `Move or rename the skill at ${skill.path}, so that this plugin's ${skill.id} skill loads, then run opencode reload.`
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
  const shadowed = shadowedSkills(facts.skills, facts.ownSkills)
  const nextStep = accounts.map(accountStep).find((step) => step !== undefined)
    ?? (unguarded.length === 0 ? undefined : AGENTS_STEP)
    ?? (shadowed[0] === undefined ? undefined : shadowStep(shadowed[0]))
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
    shadowedSkills: shadowed,
    nextStep,
  }
  return { ...status, state: SHARED_STATE[overallState(status)] }
}

export interface StatusSources {
  readonly host: HostCheck
  readonly servers: Pick<PlaudServers, "list" | "inUse">
  readonly exportRoots: readonly string[]
  /** The plugin's own skills, as it registers them. */
  readonly skills: readonly ListedSkill[]
}

export type StatusHost = {
  readonly mcp: Pick<PluginContext["mcp"], "list">
  readonly tool: Pick<PluginContext["tool"], "list">
  readonly agent: Pick<PluginContext["agent"], "list">
  readonly skill: Pick<PluginContext["skill"], "list">
}

export async function readStatus(ctx: StatusHost, sources: StatusSources): Promise<Status> {
  const [mcp, tools, agents, skills] = await Promise.all([
    ctx.mcp.list(),
    ctx.tool.list(),
    ctx.agent.list(),
    // A skill list the host cannot give reports nothing shadowed, rather than failing status.
    ctx.skill.list().then((listed) => listed.data, () => []),
  ])
  return buildStatus({
    host: sources.host,
    servers: sources.servers.list,
    inUse: sources.servers.inUse(),
    exportRoots: sources.exportRoots,
    mcp: mcp.data,
    tools: tools.map((tool) => tool.id),
    agents: agents.data,
    skills,
    ownSkills: sources.skills,
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
