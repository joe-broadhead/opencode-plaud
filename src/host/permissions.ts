import type { PluginContext, Registration } from "./context.js"
import { KNOWN_READS } from "./mcp.js"

/**
 * Default permission rules. OpenCode evaluates an agent's rules in order and
 * the last match wins, so the plugin inserts its rules right after each
 * agent's base `* * allow`:
 *
 * - every `plaud*_*` action asks: new upstream tools, and any server tool not
 *   known to be a read;
 * - the known reads are allowed again, so they never prompt and work in
 *   `opencode run`;
 * - `plaud_export` asks, and `plaud_recent`, which only reads, runs.
 *
 * Everything that follows the base allow comes later and still wins: an
 * agent's own stricter rules (Plan, Explore), the user's `permissions` rules
 * and saved "Always allow" approvals. Agents without a base allow are left
 * alone. There is no permission hook.
 */

type AgentEditor = Parameters<Parameters<PluginContext["agent"]["transform"]>[0]>[0]
export type Rule = Readonly<ReturnType<AgentEditor["list"]>[number]["permissions"][number]>

/** The permission action of the plugin's export tool. `plaud*_*` matches it too. */
export const EXPORT_ACTION = "plaud_export"

/** The permission action of the plugin's own read, `plaud_recent`, which runs like the server's reads. */
export const RECENT_ACTION = "plaud_recent"

export const DEFAULT_RULES: readonly Rule[] = [
  { action: "plaud*_*", resource: "*", effect: "ask" },
  ...KNOWN_READS.map((tool): Rule => ({ action: `plaud*_${tool}`, resource: "*", effect: "allow" })),
  { action: EXPORT_ACTION, resource: "*", effect: "ask" },
  { action: RECENT_ACTION, resource: "*", effect: "allow" },
]

function isBaseAllow(rule: Rule): boolean {
  return rule.action === "*" && rule.resource === "*" && rule.effect === "allow"
}

function same(a: Rule | undefined, b: Rule): boolean {
  return a !== undefined && a.action === b.action && a.resource === b.resource && a.effect === b.effect
}

/**
 * The agent transform. It is synchronous and does no I/O. OpenCode rebuilds
 * agents from scratch on every replay, so the rules land exactly once.
 */
export function insertDefaultRules(editor: AgentEditor): void {
  for (const agent of editor.list()) {
    editor.update(agent.id, (draft) => {
      const index = draft.permissions.findIndex(isBaseAllow)
      if (index === -1) return
      draft.permissions.splice(index + 1, 0, ...DEFAULT_RULES.map((rule) => ({ ...rule })))
    })
  }
}

export function registerPermissions(ctx: Pick<PluginContext, "agent">): Promise<Registration> {
  return ctx.agent.transform(insertDefaultRules)
}

/**
 * Agents with a base allow but without the default rules after it. OpenCode
 * creates agents defined only in the user's config after plugins run, so the
 * transform never sees them. Status names them with the per-agent fix.
 * Other plugins insert their rules at the same place, so the block may sit
 * anywhere after the base allow.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]): string[] {
  return agents
    .filter((agent) => {
      const base = agent.permissions.findIndex(isBaseAllow)
      return base !== -1 && !hasDefaultRules(agent.permissions, base + 1)
    })
    .map((agent) => agent.id)
}

function hasDefaultRules(rules: readonly Rule[], from: number): boolean {
  return rules.some((_, start) => start >= from && DEFAULT_RULES.every((rule, offset) => same(rules[start + offset], rule)))
}
