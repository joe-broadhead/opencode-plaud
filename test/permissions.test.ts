import type { Plugin } from "@opencode/plugin"
import { describe, expect, it, vi } from "vitest"
import {
  defaultRules,
  evaluate,
  EXPORT_ACTION,
  insertDefaultRules,
  NAMESPACE_ACTION,
  EVENTS_ACTION,
  RECENT_ACTION,
  registerPermissions,
  unguardedAgents,
} from "../src/host/permissions.js"
import { ACCESS_VALUES } from "../src/domain/types.js"
import type { Rule } from "../src/rpc.js"

type AgentEditor = Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]
type Agent = { id: string; permissions: Rule[] }

const allow: Rule = { action: "*", resource: "*", effect: "allow" }
const env: Rule[] = [
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

/** The built-in agents as 2.2.3 creates them, before any plugin transform. */
function builtIns(): Agent[] {
  return [
    { id: "build", permissions: [allow, ...env] },
    { id: "plan", permissions: [allow, ...env, { action: "edit", resource: "*", effect: "deny" }] },
    { id: "explore", permissions: [allow, ...env, { action: "*", resource: "*", effect: "deny" }] },
    { id: "locked", permissions: [{ action: "*", resource: "*", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }] },
  ]
}

/** A fresh editor over copies of `agents`, as the host rebuilds agent state from scratch on every replay. */
function editor(agents: readonly Agent[]) {
  const state = new Map(agents.map((agent) => [agent.id, { ...agent, permissions: agent.permissions.map((rule) => ({ ...rule })) }]))
  const value = {
    list: () => [...state.values()],
    get: (id: string) => state.get(id),
    default: () => undefined,
    update: (id: string, update: (agent: Agent) => void) => {
      const agent = state.get(id)
      if (agent) update(agent)
    },
    remove: (id: string) => void state.delete(id),
  } as unknown as AgentEditor
  return { value, agents: () => [...state.values()] }
}

function fakeAgent() {
  const callbacks: ((editor: AgentEditor) => void)[] = []
  const transform = vi.fn(async (callback: (editor: AgentEditor) => void) => {
    callbacks.push(callback)
    return { dispose: async () => undefined }
  })
  const ctx = { agent: { transform } } as unknown as Pick<Plugin.Context, "agent">
  const replay = (agents: readonly Agent[] = builtIns()) => {
    const fresh = editor(agents)
    for (const callback of callbacks) {
      const result: unknown = callback(fresh.value)
      expect(result).toBeUndefined()
    }
    return fresh.agents()
  }
  return { ctx, callbacks, transform, replay }
}

const rules = (agents: readonly Agent[], id: string) => agents.find((agent) => agent.id === id)!.permissions
/** The block for the default account alone, at the default access value. */
const DEFAULT_RULES = defaultRules(["plaud"])
const READS = ["list_files", "get_file", "get_note", "get_transcript", "get_current_user"]

describe("default permission rules", () => {
  it("allow every tool and the namespace at the default access, so a tool Plaud adds later runs too", () => {
    expect(NAMESPACE_ACTION).toBe("plaud*_*")
    expect(EXPORT_ACTION).toBe("plaud_export")
    expect(RECENT_ACTION).toBe("plaud_recent")
    expect(EVENTS_ACTION).toBe("plaud_events_list")
    expect(DEFAULT_RULES).toEqual([
      { action: NAMESPACE_ACTION, resource: "*", effect: "allow" },
      ...READS.map((read) => ({ action: `plaud_${read}`, resource: "*", effect: "allow" })),
      { action: EXPORT_ACTION, resource: "*", effect: "allow" },
      { action: RECENT_ACTION, resource: "*", effect: "allow" },
      { action: EVENTS_ACTION, resource: "*", effect: "allow" },
    ])
    // Every rule is an allow, and the namespace comes first, so the value alone decides what the plugin does not know.
    expect(DEFAULT_RULES.every((rule) => rule.effect === "allow")).toBe(true)
    const agent = [allow, ...DEFAULT_RULES]
    for (const action of ["plaud_delete_file", "plaud_bulk_get_file", "plaudit_get_file", "plaud-work_get_file", EXPORT_ACTION]) expect(evaluate(agent, action), action).toBe("allow")
  })

  it("asks for a change at ask-changes and denies it at read-only, while the reads and the namespace follow the value", () => {
    for (const [access, effect] of [["ask-changes", "ask"], ["read-only", "deny"]] as const) {
      const block = defaultRules(["plaud", "plaud-work"], access)
      expect(block[0], access).toEqual({ action: NAMESPACE_ACTION, resource: "*", effect })
      const agent = [allow, ...block]
      for (const server of ["plaud", "plaud-work"]) {
        for (const read of READS) expect(evaluate(agent, `${server}_${read}`), `${access} ${server}_${read}`).toBe("allow")
      }
      expect(evaluate(agent, RECENT_ACTION), access).toBe("allow")
      expect(evaluate(agent, EXPORT_ACTION), access).toBe(effect)
      // A later Plaud tool, an unconfigured account and another plaud* server follow the value too (PLAUD-5).
      for (const action of ["plaud_delete_file", "plaud_bulk_get_file", "plaud-other_get_file", "plaudit_get_file", "plaud_recent_files"]) expect(evaluate(agent, action), `${access} ${action}`).toBe(effect)
    }
    expect(ACCESS_VALUES).toEqual(["all", "ask-changes", "read-only"])
    expect(defaultRules(["plaud"])).toEqual(DEFAULT_RULES)
  })

  it("lands right after each agent's base allow, ahead of the agent's own rules", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    const after = agents()
    expect(rules(after, "build")).toEqual([allow, ...DEFAULT_RULES, ...env])
    expect(rules(after, "plan")).toEqual([allow, ...DEFAULT_RULES, ...env, { action: "edit", resource: "*", effect: "deny" }])
    expect(rules(after, "explore").at(-1)).toEqual({ action: "*", resource: "*", effect: "deny" })
    expect(rules(after, "explore").slice(0, 1 + DEFAULT_RULES.length)).toEqual([allow, ...DEFAULT_RULES])
  })

  it("inserts after the base allow wherever it sits", () => {
    const earlier: Rule = { action: "other_*", resource: "*", effect: "ask" }
    const { value, agents } = editor([{ id: "custom", permissions: [earlier, allow, ...env] }])
    insertDefaultRules(DEFAULT_RULES)(value)
    expect(rules(agents(), "custom")).toEqual([earlier, allow, ...DEFAULT_RULES, ...env])
  })

  it("leaves agents without a base allow untouched", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    expect(rules(agents(), "locked")).toEqual(rules(builtIns(), "locked"))
  })

  it("inserts copies, so one agent's edits never reach another's rules", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    const after = agents()
    expect(rules(after, "build")[1]).not.toBe(rules(after, "plan")[1])
    expect(rules(after, "build")[1]).not.toBe(DEFAULT_RULES[0])
  })

  it("registers one synchronous agent transform and no permission hook", async () => {
    const { ctx, transform } = fakeAgent()
    const hook = vi.fn()
    const registration = await registerPermissions({ ...ctx, permission: { hook } } as Pick<Plugin.Context, "agent">, DEFAULT_RULES)
    expect(transform).toHaveBeenCalledOnce()
    expect(hook).not.toHaveBeenCalled()
    expect(typeof registration.dispose).toBe("function")
  })

  it("keeps one copy of the rules on every replay", async () => {
    const { ctx, replay } = fakeAgent()
    await registerPermissions(ctx, DEFAULT_RULES)
    for (let run = 0; run < 3; run++) {
      const after = replay()
      for (const id of ["build", "plan", "explore"]) {
        expect(rules(after, id).filter((rule) => rule.action === NAMESPACE_ACTION)).toHaveLength(1)
        expect(rules(after, id).filter((rule) => rule.action === EXPORT_ACTION)).toHaveLength(1)
      }
    }
  })
})

describe("unguarded agents", () => {
  it("names no agent at all, because nothing is held back at the default access", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    const configOnly: Agent = { id: "reviewer", permissions: [allow, ...env] }
    expect(unguardedAgents([...agents(), configOnly], DEFAULT_RULES)).toEqual([])
    // Even one whose own rules would run every Plaud tool: at `all` the block holds nothing back.
    expect(unguardedAgents([{ id: "smoke-bot", permissions: [allow, { action: "*", resource: "*", effect: "allow" }] }], DEFAULT_RULES)).toEqual([])
  })

  it("names agents with a base allow that never got the rules at a restricting value", () => {
    const block = defaultRules(["plaud"], "ask-changes")
    const { value, agents } = editor(builtIns())
    insertDefaultRules(block)(value)
    const configOnly: Agent = { id: "reviewer", permissions: [allow, ...env] }
    expect(unguardedAgents([...agents(), configOnly], block, "ask-changes")).toEqual(["reviewer"])
  })

  it("still finds the rules when a later plugin inserts its own after the base allow", () => {
    const block = defaultRules(["plaud"], "ask-changes")
    const { value, agents } = editor(builtIns())
    insertDefaultRules(block)(value)
    const other: Rule = { action: "other_*", resource: "*", effect: "ask" }
    const shifted = agents().map((agent) => agent.id === "locked" ? agent : { ...agent, permissions: [allow, other, ...agent.permissions.slice(1)] })
    expect(rules(shifted, "build").slice(0, 3)).toEqual([allow, other, block[0]])
    expect(unguardedAgents(shifted, block, "ask-changes")).toEqual([])
  })

  it("names an agent that has only part of the rules, without the namespace rule", () => {
    const block = defaultRules(["plaud"], "ask-changes")
    const partial: Agent = { id: "partial", permissions: [allow, ...block.slice(1)] }
    expect(unguardedAgents([partial], block, "ask-changes")).toEqual(["partial"])
  })

  it("names an agent whose rules come only before its base allow", () => {
    const block = defaultRules(["plaud"], "read-only")
    const early: Agent = { id: "early", permissions: [...block, allow] }
    expect(unguardedAgents([early], block, "read-only")).toEqual(["early"])
  })

  it("does not name an agent whose own rules already ask for or deny Plaud's tools (LIVE-1)", () => {
    const block = defaultRules(["plaud"], "ask-changes")
    const asks: Agent = { id: "perf-probe", permissions: [allow, ...env, { action: "*", resource: "*", effect: "ask" }] }
    const denies: Agent = { id: "quiet", permissions: [allow, { action: "plaud*_*", resource: "*", effect: "deny" }] }
    const asksPlaud: Agent = { id: "careful", permissions: [allow, { action: "plaud*", resource: "*", effect: "ask" }] }
    const allowsAll: Agent = { id: "smoke-bot", permissions: [allow, { action: "*", resource: "*", effect: "allow" }] }
    expect(unguardedAgents([asks, denies, asksPlaud, allowsAll], block, "ask-changes")).toEqual(["smoke-bot"])
  })

  it("does not name agents without a base allow", () => {
    const block = defaultRules(["plaud"], "read-only")
    expect(unguardedAgents([{ id: "locked", permissions: [{ action: "*", resource: "*", effect: "deny" }] }], block, "read-only")).toEqual([])
  })
})
