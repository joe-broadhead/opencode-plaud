import type { Plugin } from "@opencode/plugin"
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_RULES,
  EXPORT_ACTION,
  insertDefaultRules,
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

describe("default permission rules", () => {
  it("asks for every plaud tool, allows the known reads, and asks for exports", () => {
    expect(EXPORT_ACTION).toBe("plaud_export")
    expect(DEFAULT_RULES).toEqual([
      { action: "plaud*_*", resource: "*", effect: "ask" },
      { action: "plaud*_list_files", resource: "*", effect: "allow" },
      { action: "plaud*_get_file", resource: "*", effect: "allow" },
      { action: "plaud*_get_note", resource: "*", effect: "allow" },
      { action: "plaud*_get_transcript", resource: "*", effect: "allow" },
      { action: "plaud*_get_current_user", resource: "*", effect: "allow" },
      { action: "plaud_export", resource: "*", effect: "ask" },
    ])
  })

  it("lands right after each agent's base allow, ahead of the agent's own rules", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(value)
    const after = agents()
    expect(rules(after, "build")).toEqual([allow, ...DEFAULT_RULES, ...env])
    expect(rules(after, "plan")).toEqual([allow, ...DEFAULT_RULES, ...env, { action: "edit", resource: "*", effect: "deny" }])
    expect(rules(after, "explore").at(-1)).toEqual({ action: "*", resource: "*", effect: "deny" })
    expect(rules(after, "explore").slice(0, 8)).toEqual([allow, ...DEFAULT_RULES])
  })

  it("inserts after the base allow wherever it sits", () => {
    const earlier: Rule = { action: "other_*", resource: "*", effect: "ask" }
    const { value, agents } = editor([{ id: "custom", permissions: [earlier, allow, ...env] }])
    insertDefaultRules(value)
    expect(rules(agents(), "custom")).toEqual([earlier, allow, ...DEFAULT_RULES, ...env])
  })

  it("leaves agents without a base allow untouched", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(value)
    expect(rules(agents(), "locked")).toEqual(rules(builtIns(), "locked"))
  })

  it("inserts copies, so one agent's edits never reach another's rules", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(value)
    const after = agents()
    expect(rules(after, "build")[1]).not.toBe(rules(after, "plan")[1])
    expect(rules(after, "build")[1]).not.toBe(DEFAULT_RULES[0])
  })

  it("registers one synchronous agent transform and no permission hook", async () => {
    const { ctx, transform } = fakeAgent()
    const hook = vi.fn()
    const registration = await registerPermissions({ ...ctx, permission: { hook } } as Pick<Plugin.Context, "agent">)
    expect(transform).toHaveBeenCalledOnce()
    expect(transform).toHaveBeenCalledWith(insertDefaultRules)
    expect(hook).not.toHaveBeenCalled()
    expect(typeof registration.dispose).toBe("function")
  })

  it("keeps one copy of the rules on every replay", async () => {
    const { ctx, replay } = fakeAgent()
    await registerPermissions(ctx)
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
    insertDefaultRules(value)
    const configOnly: Agent = { id: "reviewer", permissions: [allow, ...env] }
    expect(unguardedAgents([...agents(), configOnly])).toEqual(["reviewer"])
  })

  it("still finds the rules when a later plugin inserts its own after the base allow", () => {
    const { value, agents } = editor(builtIns())
    insertDefaultRules(value)
    const other: Rule = { action: "other_*", resource: "*", effect: "ask" }
    const shifted = agents().map((agent) => agent.id === "locked" ? agent : { ...agent, permissions: [allow, other, ...agent.permissions.slice(1)] })
    expect(rules(shifted, "build").slice(0, 3)).toEqual([allow, other, DEFAULT_RULES[0]])
    expect(unguardedAgents(shifted)).toEqual([])
  })

  it("names an agent that has only part of the rules", () => {
    const partial: Agent = { id: "partial", permissions: [allow, ...DEFAULT_RULES.slice(0, 3)] }
    expect(unguardedAgents([partial])).toEqual(["partial"])
  })

  it("names an agent whose rules come only before its base allow", () => {
    const early: Agent = { id: "early", permissions: [...DEFAULT_RULES, allow] }
    expect(unguardedAgents([early])).toEqual(["early"])
  })

  it("does not name agents without a base allow", () => {
    expect(unguardedAgents([{ id: "locked", permissions: [{ action: "*", resource: "*", effect: "deny" }] }])).toEqual([])
  })
})
