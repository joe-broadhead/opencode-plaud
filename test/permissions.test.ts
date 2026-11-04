import type { Plugin } from "@opencode/plugin"
import { describe, expect, it, vi } from "vitest"
import {
  defaultRules,
  evaluate,
  EXPORT_ACTION,
  insertDefaultRules,
  RECENT_ACTION,
  registerPermissions,
  unguardedAgents,
  type Rule,
} from "../src/host/permissions.js"

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
/** The block for the default account alone. */
const DEFAULT_RULES = defaultRules(["plaud"])

describe("default permission rules", () => {
  it("asks for every plaud tool, allows each configured server's known reads and plaud_recent by exact name, and asks for exports", () => {
    expect(EXPORT_ACTION).toBe("plaud_export")
    expect(RECENT_ACTION).toBe("plaud_recent")
    const reads = ["list_files", "get_file", "get_note", "get_transcript", "get_current_user"]
    expect(defaultRules(["plaud", "plaud-work"])).toEqual([
      { action: "plaud*_*", resource: "*", effect: "ask" },
      ...reads.map((read) => ({ action: `plaud_${read}`, resource: "*", effect: "allow" })),
      ...reads.map((read) => ({ action: `plaud-work_${read}`, resource: "*", effect: "allow" })),
      { action: "plaud_export", resource: "*", effect: "ask" },
      { action: "plaud_recent", resource: "*", effect: "allow" },
    ])
  })

  it("allows no tool that only ends like a known read: a later upstream tool, an unconfigured account or another plaud* server asks (PLAUD-5)", () => {
    const agent = [allow, ...defaultRules(["plaud", "plaud-work"])]
    expect(["plaud_get_file", "plaud-work_get_transcript", "plaud-work_get_current_user"].map((action) => evaluate(agent, action))).toEqual(["allow", "allow", "allow"])
    expect(evaluate(agent, RECENT_ACTION)).toBe("allow")
    for (const action of ["plaud_bulk_get_file", "plaud-work_bulk_get_note", "plaud-other_get_file", "plaudit_get_file", "plaud_delete_file", "plaud-work_recent", "plaud_recent_files", EXPORT_ACTION]) {
      expect(evaluate(agent, action), action).toBe("ask")
    }
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
        expect(rules(after, id).filter((rule) => rule.action === "plaud*_*")).toHaveLength(1)
        expect(rules(after, id).filter((rule) => rule.action === EXPORT_ACTION)).toHaveLength(1)
      }
    }
  })
})

describe("unguarded agents", () => {
  it("names agents with a base allow that never got the rules", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    const configOnly: Agent = { id: "reviewer", permissions: [allow, ...env] }
    expect(unguardedAgents([...agents(), configOnly], DEFAULT_RULES)).toEqual(["reviewer"])
  })

  it("still finds the rules when a later plugin inserts its own after the base allow", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(DEFAULT_RULES)(value)
    const other: Rule = { action: "other_*", resource: "*", effect: "ask" }
    const shifted = agents().map((agent) => agent.id === "locked" ? agent : { ...agent, permissions: [allow, other, ...agent.permissions.slice(1)] })
    expect(rules(shifted, "build").slice(0, 3)).toEqual([allow, other, DEFAULT_RULES[0]])
    expect(unguardedAgents(shifted, DEFAULT_RULES)).toEqual([])
  })

  it("names an agent that has only part of the rules, without the ask for every Plaud tool", () => {
    const partial: Agent = { id: "partial", permissions: [allow, ...DEFAULT_RULES.slice(1)] }
    expect(unguardedAgents([partial], DEFAULT_RULES)).toEqual(["partial"])
  })

  it("names an agent whose rules come only before its base allow", () => {
    const early: Agent = { id: "early", permissions: [...DEFAULT_RULES, allow] }
    expect(unguardedAgents([early], DEFAULT_RULES)).toEqual(["early"])
  })

  it("does not name an agent whose own rules already ask for or deny Plaud's tools (LIVE-1)", () => {
    const asks: Agent = { id: "perf-probe", permissions: [allow, ...env, { action: "*", resource: "*", effect: "ask" }] }
    const denies: Agent = { id: "quiet", permissions: [allow, { action: "plaud*_*", resource: "*", effect: "deny" }] }
    const asksPlaud: Agent = { id: "careful", permissions: [allow, { action: "plaud*", resource: "*", effect: "ask" }] }
    const allowsAll: Agent = { id: "smoke-bot", permissions: [allow, { action: "*", resource: "*", effect: "allow" }] }
    expect(unguardedAgents([asks, denies, asksPlaud, allowsAll], DEFAULT_RULES)).toEqual(["smoke-bot"])
  })

  it("does not name agents without a base allow", () => {
    expect(unguardedAgents([{ id: "locked", permissions: [{ action: "*", resource: "*", effect: "deny" }] }], DEFAULT_RULES)).toEqual([])
  })
})
