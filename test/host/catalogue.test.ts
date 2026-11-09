import { expect, it } from "vitest"
import * as z from "zod"
import { MODEL_ID } from "../fixtures/fake-plaud.js"
import { startHost } from "./harness.js"

it("keeps the forced Plaud catalogue under 1,000 tokens", async () => {
  const host = await startHost({ config: (fake) => ({
    providers: { lmstudio: { settings: { baseURL: `${fake.origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
  }) })
  try {
    await host.until("the Plaud tools", async () => (await host.tools()).find(tool => tool.id === "plaud_export"))
    const filler = await host.probe().tool.transform(editor => {
      editor.namespace({ name: "filler", description: "Spends the inline budget." })
      editor.add({ name: "pad", description: "pad", input: z.object({ note: z.string().describe("x".repeat(9000)) }), options: { namespace: "filler", permission: "filler_pad", pinned: true }, execute: async () => ({ content: "ok" }) } as never)
    })
    try {
      await host.until("the scripted model", async () => {
        const models = (await host.opencode.model.list({ location: host.location })) as unknown as { data: { id: string; providerID: string }[] }
        return models.data.find(model => model.providerID === "lmstudio" && model.id === MODEL_ID)
      })
      const session = await host.opencode.sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })
      await host.opencode.sessions.prompt({ sessionID: session.id, text: "Reply with ok." })
      const system = await host.until("the catalogue", async () => {
        for (const request of host.fake.model.requests as { messages?: { role: string; content?: unknown }[] }[]) {
          const text = (request.messages ?? []).filter(message => message.role === "system").map(message => typeof message.content === "string" ? message.content : "").join("\n")
          if (text.includes("- plaud (")) return text
        }
        return undefined
      })
      const lines = system.split("\n"), start = lines.findIndex(line => line.startsWith("- plaud (")), section = [lines[start]!]
      for (let i = start + 1; i < lines.length && lines[i]!.startsWith("  "); i++) section.push(lines[i]!)
      expect(Math.round(section.join("\n").length / 4)).toBeLessThanOrEqual(1000)
    } finally { await filler.dispose() }
  } finally { await host.close() }
}, 120_000)
