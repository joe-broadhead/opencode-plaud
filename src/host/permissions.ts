import type { PluginContext, Registration } from "./context.js"
import { KNOWN_READS } from "./mcp.js"
// The status RPC's plain rule is the one Rule type: the TUI bundle reads src/rpc.ts and must not import this file.
import type { Rule } from "../rpc.js"

/**
 * Default permission rules. OpenCode evaluates an agent's rules in order and
 * the last match wins, so the plugin inserts its rules right after each
 * agent's base `* * allow`:
 *
 * - every `plaud*_*` action asks: new upstream tools, and any server tool not
 *   known to be a read;
 * - the known reads of each configured account's server are allowed again by
 *   exact name (`plaud_get_file`, `plaud-work_get_file`, …), so they never
 *   prompt and work in `opencode run`, and no other tool whose name merely
 *   ends like a read (`plaud_bulk_get_file`, `plaudit_get_file`) is allowed;
 * - `plaud_export` asks;
 * - `plaud_recent`, the plugin's own read, is allowed by its exact name. It
 *   is one tool for every account: it asserts `plaud_recent` with the account
 *   as the resource, and reads through that account's `<server>_list_files`,
 *   whose own exact-name rule still applies.
 * - `plaud_events_list`, the plugin's other read, for Memory's collector, is
 *   allowed the same way: it asserts `plaud_events_list` with the account as
 *   the resource, and reads through `get_current_user` and `list_files`.
 *
 * Everything that follows the base allow comes later and still wins: an
 * agent's own stricter rules (Plan, Explore), the user's `permissions` rules
 * and saved "Always allow" approvals. Agents without a base allow are left
 * alone. There is no permission hook.
 */

type AgentEditor = Parameters<Parameters<PluginContext["agent"]["transform"]>[0]>[0]

/** The permission action of the plugin's export tool. `plaud*_*` matches it too. */
export const EXPORT_ACTION = "plaud_export"

/** The permission action of the plugin's own read, `plaud_recent`. `plaud*_*` matches it too. */
export const RECENT_ACTION = "plaud_recent"

/** The permission action of the plugin's other read, `plaud_events_list`, for Memory's collector. `plaud*_*` matches it too. */
export const EVENTS_ACTION = "plaud_events_list"

/** The plugin's own tools: `plaud_` names them too, but they are not a server's. */
export const OWN_TOOLS: readonly string[] = [EXPORT_ACTION, RECENT_ACTION, EVENTS_ACTION]

/** The default rules for these servers, the default account's `plaud` first. */
export function defaultRules(servers: readonly string[]): Rule[] {
  return [
    { action: "plaud*_*", resource: "*", effect: "ask" },
    ...servers.flatMap((server) => KNOWN_READS.map((tool): Rule => ({ action: `${server}_${tool}`, resource: "*", effect: "allow" }))),
    { action: EXPORT_ACTION, resource: "*", effect: "ask" },
    { action: RECENT_ACTION, resource: "*", effect: "allow" },
    { action: EVENTS_ACTION, resource: "*", effect: "allow" },
  ]
}

function isBaseAllow(rule: Rule): boolean {
  return rule.action === "*" && rule.resource === "*" && rule.effect === "allow"
}

function same(a: Rule | undefined, b: Rule): boolean {
  return a !== undefined && a.action === b.action && a.resource === b.resource && a.effect === b.effect
}

/**
 * The agent transform for a block. It is synchronous and does no I/O.
 * OpenCode rebuilds agents from scratch on every replay, so the rules land
 * exactly once.
 */
export function insertDefaultRules(block: readonly Rule[]): (editor: AgentEditor) => void {
  return (editor) => {
    for (const agent of editor.list()) {
      editor.update(agent.id, (draft) => {
        const index = draft.permissions.findIndex(isBaseAllow)
        if (index === -1) return
        draft.permissions.splice(index + 1, 0, ...block.map((rule) => ({ ...rule })))
      })
    }
  }
}

export function registerPermissions(ctx: Pick<PluginContext, "agent">, block: readonly Rule[]): Promise<Registration> {
  return ctx.agent.transform(insertDefaultRules(block))
}

/** A Plaud tool the plugin does not know: what an agent's rules do for it shows whether Plaud's other tools ask. */
const UNKNOWN_TOOL = "plaud_unknown_tool"

/**
 * Agents that need the per-agent fix: a base allow, no block after it, and
 * rules that would let an unknown Plaud tool run without asking. OpenCode
 * creates agents defined only in the user's config after plugins run, so
 * the transform never sees them; an agent whose own rules already ask for
 * or deny Plaud's tools needs no fix and is not listed. Other plugins insert
 * their rules at the same place, so the block may sit anywhere after the
 * base allow.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], block: readonly Rule[]): string[] {
  return agents
    .filter((agent) => {
      const base = agent.permissions.findIndex(isBaseAllow)
      return base !== -1 && !hasBlock(agent.permissions, base + 1, block) && evaluate(agent.permissions, UNKNOWN_TOOL) === "allow"
    })
    .map((agent) => agent.id)
}

function hasBlock(rules: readonly Rule[], from: number, block: readonly Rule[]): boolean {
  return rules.some((_, start) => start >= from && block.every((rule, offset) => same(rules[start + offset], rule)))
}

/** OpenCode's wildcards: `*` matches any run of characters and `?` one character, over the whole text. */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value)

/** The effect of `rules` for an MCP tool call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(rules: readonly Rule[], action: string): Rule["effect"] {
  return rules.findLast((rule) => matches(rule.action, action) && matches(rule.resource, "*"))?.effect ?? "ask"
}
