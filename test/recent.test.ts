/** `recent`: the `plaud.recent` snapshot, a `list` of the newest recordings, newest first. */
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { describe, expect, it } from "vitest"
import { run, runtimeFor } from "./support/handlers.js"
import { manifest } from "../src/manifest.js"

const source = findSource(manifest, "plaud.recent")!

describe("recent", () => {
  it("answers the newest recordings of one account as a list, newest first", async () => {
    const runtime = runtimeFor()
    const answer = (await run(runtime, "recent", { limit: 3 }, "work")) as { source: string; account: string; data: { items: { id: string; text: string }[]; editable: boolean }; asOf: string; trust: string }
    expect(answer.source).toBe("recent")
    expect(answer.account).toBe("work")
    expect(answer.data.editable).toBe(false)
    expect(answer.data.items.map((item) => item.id)).toEqual(["w-4", "w-3", "w-2"])
    expect(answer.data.items[1]!.text).toBe("Board meeting · 2026-11-09 08:15 UTC · 1 h 0 min")
    expect(answer.asOf).toBe("2026-11-20T00:00:00.000Z")
    expect(acceptAnswer(source, "work", answer).ok).toBe(true)
  })

  it("leaves out a title that holds a secret", async () => {
    const runtime = runtimeFor()
    const answer = (await run(runtime, "recent", {}, "work")) as { data: { items: { id: string }[] } }
    expect(answer.data.items.map((item) => item.id)).not.toContain("w-5")
    expect(answer.data.items).toHaveLength(4)
  })

  it("defaults to 8 and asks Plaud for at least its minimum page", async () => {
    const runtime = runtimeFor()
    await run(runtime, "recent", {}, "personal")
    const calls = (runtime.provider as unknown as { calls: { tool: string; args: Record<string, unknown> }[] }).calls
    const list = calls.find((call) => call.tool === "list_files")
    expect(list?.args["page_size"]).toBeGreaterThanOrEqual(10)
  })

  it("caps the list at 20 items and refuses more", async () => {
    const runtime = runtimeFor()
    const answer = (await run(runtime, "recent", { limit: 20 }, "work")) as { data: { items: unknown[] } }
    expect(answer.data.items.length).toBeLessThanOrEqual(20)
  })
})
