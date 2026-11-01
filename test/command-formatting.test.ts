import { describe, expect, it, vi } from "vitest"
import { DEFAULT_RULES } from "../src/host/permissions.js"
import { registerCommands, STATUS_COMMAND } from "../src/host/commands.js"
import { statusLines, type Status } from "../src/rpc.js"
import { formatStatus, summarizeStatus } from "../src/status.js"

function status(overrides: Partial<Status> = {}): Status {
  return {
    accounts: [
      { account: "default", server: "plaud", state: "sign_in_needed" },
      { account: "work", server: "plaud-work", state: "signed_in" },
    ],
    exportRoots: ["/fixture/Plaud", "/fixture/Shared"],
    tools: { visible: 6, unknown: 0, unknownNames: [] },
    host: { version: "2.2.3", tested: true },
    unguardedAgents: [],
    permissionsBlock: DEFAULT_RULES.map((rule) => ({ ...rule })),
    nextStep: "Run /connect and choose Plaud, then press o or Enter to open the sign-in page.",
    ...overrides,
  }
}

type Execute = (input: { sessionID: string; delivery: "steer" | "queue"; prompt: unknown }) => Promise<void>

function register(read: () => Promise<Status>) {
  const added: { name: string; description?: string; execute: Execute }[] = []
  const synthetic = vi.fn(async () => ({}))
  const ctx = {
    command: {
      transform: vi.fn(async (callback: (editor: { add: (command: (typeof added)[number]) => void }) => void) => {
        callback({ add: (command) => added.push(command) })
        return { dispose: async () => undefined }
      }),
    },
    session: { synthetic },
  }
  return { registration: registerCommands(ctx as never, read), added, synthetic }
}

describe("/plaud-status text", () => {
  it("is the summary, then the same lines the TUI dialog shows", () => {
    const value = status()
    const text = formatStatus(value)
    expect(text.split("\n")).toEqual([
      "**Plaud: sign-in required**",
      "",
      ...statusLines(value).map((line) => `- ${line.label}: ${line.value}`),
    ])
    expect(text).toContain("- Connection: default: sign-in required; work: connected")
    expect(text).toContain("- Account: default (server plaud), work (server plaud-work)")
    expect(text).toContain("- Access: Reads run without asking. Exports ask, and write only in /fixture/Plaud, /fixture/Shared.")
    expect(text).toContain("- Tools: 6 available")
    expect(text).toContain("- Next step: Run /connect and choose Plaud,")
    expect(summarizeStatus(value)).toBe("Plaud: sign-in required")
  })

  it("adds the rules as JSON to copy under the agents line while an agent misses them", () => {
    const text = formatStatus(status({ unguardedAgents: ["reviewer"], nextStep: "fix reviewer" }))
    expect(text).toMatch(/- Agents without default rules: reviewer\.[^\n]*\n\n```json\n/)
    expect(text).toMatch(/```\n\n- OpenCode: /)
    const block = /```json\n(.*?)\n```/s.exec(text)?.[1]
    expect(JSON.parse(block!)).toEqual(DEFAULT_RULES)
    // One rule per line, so it reads and copies cleanly.
    expect(block!.split("\n")).toHaveLength(DEFAULT_RULES.length + 2)
    expect(formatStatus(status())).not.toContain("```")
  })

  it("speaks only of sign-in, folders, permissions and OpenCode", () => {
    const text = formatStatus(status({ unguardedAgents: ["reviewer"], nextStep: "fix reviewer" }))
    expect(text).not.toMatch(/\bplans?\b|commit|plaud_auth|plaud-login|token|https?:/i)
  })
})

describe("/plaud-status command", () => {
  it("registers only /plaud-status", async () => {
    const { registration, added } = register(async () => status())
    await registration
    expect(added.map((command) => command.name)).toEqual([STATUS_COMMAND.name])
    expect(STATUS_COMMAND.name).toBe("plaud-status")
    expect(added[0]!.description).toBe(STATUS_COMMAND.description)
  })

  it("posts the status as a synthetic message without a model turn", async () => {
    const value = status()
    const { registration, added, synthetic } = register(async () => value)
    await registration
    await added[0]!.execute({ sessionID: "ses_1", delivery: "queue", prompt: { text: "/plaud-status" } })
    expect(synthetic).toHaveBeenCalledWith({
      sessionID: "ses_1",
      text: formatStatus(value),
      description: "Plaud: sign-in required",
      metadata: { source: "opencode-plaud", command: "plaud-status" },
      delivery: "queue",
      resume: false,
    })
  })

  it("posts a coded message with a next step when the status cannot be read", async () => {
    const { registration, added, synthetic } = register(async () => {
      throw new Error("mcp list failed")
    })
    await registration
    await added[0]!.execute({ sessionID: "ses_1", delivery: "steer", prompt: { text: "" } })
    expect(synthetic).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Plaud: status unavailable",
        delivery: "steer",
        resume: false,
        text: expect.stringMatching(/^STATUS_UNAVAILABLE: Plaud's status could not be read \(mcp list failed\)\. Next step: /),
      }),
    )
  })
})
