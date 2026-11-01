import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE } from "../../src/domain/redact.js"
import { MODEL_ID, SIGNATURE } from "../fixtures/fake-plaud.js"
import { startHost, type Harness } from "./harness.js"

/**
 * What a model receives from a direct Plaud tool call. The user's own `plaud`
 * server turns Code Mode off, so its tools are the model's own tools, and a
 * scripted model on the loopback fake (an LM Studio-compatible API) calls them
 * in a real session turn. Each chat request is what a provider would receive.
 */

let host: Harness

beforeAll(async () => {
  host = await startHost({
    config: (fake) => ({
      mcp: { servers: { plaud: { type: "remote", url: fake.url, codemode: false } } },
      // No model leaves the machine: LM Studio's local API is the fake; the other local providers are off.
      providers: { lmstudio: { settings: { baseURL: `${fake.origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    }),
  })
  await host.until("the scripted model", async () => {
    const models = (await host.opencode.model.list({ location: host.location })) as unknown as { data: { id: string; providerID: string }[] }
    return models.data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID)
  })
  await host.until("the direct Plaud tools", async () => ((await host.tools()).some((tool) => tool.id === "plaud_get_note") ? true : undefined))
})

afterAll(async () => {
  await host?.close()
})

describe("direct tool calls in a model turn", () => {
  it("never show the model a signed link", async () => {
    host.fake.model.script = [
      { tool: "plaud_get_file", arguments: { file_id: "rec-1" } },
      { tool: "plaud_get_note", arguments: { file_id: "rec-1" } },
    ]
    const sessionID = (await host.opencode.sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await host.opencode.sessions.prompt({ sessionID, text: "Summarise recording rec-1." })
    const turns = await host.until("the model's final turn", async () => {
      const turns = host.fake.model.requests.filter((request) => (request as { tools?: unknown[] }).tools?.length)
      return turns.length >= 3 ? turns : undefined
    })

    const offered = (turns[0] as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name)
    expect(offered).toEqual(expect.arrayContaining(["plaud_get_file", "plaud_get_note"]))
    expect(host.fake.calls.map((call) => call.tool)).toEqual(expect.arrayContaining(["get_file", "get_note"]))

    // The last request carries both tool results, as the provider receives them.
    const results = (turns.at(-1) as { messages: { role: string; content: unknown }[] }).messages.filter((message) => message.role === "tool")
    expect(results).toHaveLength(2)
    const [file, note] = results.map((message) => JSON.stringify(message.content))
    expect(file).toContain(AUDIO_URL_NOTICE)
    expect(file!.split(DATA_LINK_NOTICE)).toHaveLength(3)
    expect(note).toContain(DATA_LINK_NOTICE)
    expect(note).toContain("Ship on Friday.")

    const sent = JSON.stringify(host.fake.model.requests)
    expect(sent).not.toContain(SIGNATURE)
    expect(sent).not.toContain("X-Amz-")
  })
})
