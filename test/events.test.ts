/** `events_list`: the recordings source, its cursor, its refusals and its account bound. */
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { EventsListResult } from "@we-the-rebel-alliance/plugin-contract/events"
import { describe, expect, it } from "vitest"
import { refusal, run, runtimeFor } from "./support/handlers.js"
import { manifest } from "../src/manifest.js"

const SINCE = "2026-11-01T00:00:00.000Z"
const source = findSource(manifest, "plaud.recordings")!

/** A runtime whose work account has probed, as a page names its owner. */
async function probed() {
  const runtime = runtimeFor()
  await run(runtime, "probe", { source: "recordings" }, "work")
  return runtime
}

const list = async (runtime: ReturnType<typeof runtimeFor>, input: Record<string, unknown>, account = "work") =>
  (await run(runtime, "events_list", input, account)) as EventsListResult

describe("events_list", () => {
  it("lists the work account's recordings oldest first, as meetings, and refuses the secret title", async () => {
    const runtime = await probed()
    const page = await list(runtime, { source: "recordings", since: SINCE })
    expect(page.events.map((event) => [event.external_id, event.title, event.occurred_at, event.kind])).toEqual([
      ["w-1", "Weekly sync", "2026-11-02T09:00:00.000Z", "meeting"],
      ["w-2", "Customer call", "2026-11-04T14:30:00.000Z", "meeting"],
      ["w-3", "Board meeting", "2026-11-09T08:15:00.000Z", "meeting"],
      ["w-4", "Voice memo", "2026-11-10T07:00:00.000Z", "meeting"],
    ])
    expect(page.refused).toEqual([{ external_id: "w-5", reason: "secret", detail: "holds a secret (api key)" }])
    expect(page.account).toBe("work")
    expect(page.owner).toEqual({ id: "plaud:user-work", label: "Ana" })
    expect(page.trust).toBe("untrusted")
    expect(page.more).toBe(false)
    const accepted = acceptAnswer(source, "work", page)
    expect(accepted.ok).toBe(true)
  })

  it("re-lists nothing for the cursor it answered, and keeps the refusals behind it", async () => {
    const runtime = await probed()
    const first = await list(runtime, { source: "recordings", since: SINCE })
    const next = await list(runtime, { source: "recordings", cursor: first.cursor })
    expect(next.events).toEqual([])
    expect(next.refused).toBeUndefined()
    expect(next.more).toBe(false)
  })

  it("keeps the since window through cursor pages of limit 1: every matching recording once, none from before since", async () => {
    const runtime = await probed()
    const since = "2026-11-05T00:00:00.000Z"
    const seen: string[] = []
    const refused: string[] = []
    let page = await list(runtime, { source: "recordings", since, limit: 1 })
    for (;;) {
      seen.push(...page.events.map((event) => event.external_id))
      refused.push(...(page.refused ?? []).map((entry) => entry.external_id))
      if (!page.more) break
      // The next page names only the cursor: the since window has to be carried by it.
      page = await list(runtime, { source: "recordings", cursor: page.cursor, limit: 1 })
    }
    expect(seen).toEqual(["w-3", "w-4"])
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).not.toContain("w-1")
    expect(seen).not.toContain("w-2")
    expect(refused).toEqual(["w-5"])
  })

  it("refuses another account's cursor as CURSOR_INVALID", async () => {
    const runtime = await probed()
    await run(runtime, "probe", { source: "recordings" }, "personal")
    const work = await list(runtime, { source: "recordings", since: SINCE })
    expect(await refusal(run(runtime, "events_list", { source: "recordings", cursor: work.cursor }, "personal"))).toMatch(/^CURSOR_INVALID: .* Next step: /)
  })

  it("answers an empty window at the same shape", async () => {
    const runtime = await probed()
    const page = await list(runtime, { source: "recordings", since: "2026-11-20T00:00:00.000Z" })
    expect(page.events).toEqual([])
    expect(page.more).toBe(false)
    expect(acceptAnswer(source, "work", page).ok).toBe(true)
  })

  it("reads the personal account's own recordings", async () => {
    const runtime = runtimeFor()
    await run(runtime, "probe", { source: "recordings" }, "personal")
    const page = await list(runtime, { source: "recordings", since: SINCE }, "personal")
    expect(page.events.map((event) => [event.external_id, event.title])).toEqual([["p-1", "Grocery list"]])
  })

  it("refuses a page when no probe has named the account's owner", async () => {
    const runtime = runtimeFor()
    expect(await refusal(run(runtime, "events_list", { source: "recordings", since: SINCE }, "work"))).toMatch(/^UNAVAILABLE: no probe has named the signed-in user/)
  })

  it("refuses an unknown source and an input it does not have", async () => {
    const runtime = await probed()
    expect(await refusal(run(runtime, "events_list", { source: "other" }, "work"))).toMatch(/^SOURCE_UNKNOWN: /)
    expect(await refusal(run(runtime, "events_list", { scope: { channels: ["C1"] } }, "work"))).toMatch(/^INPUT_INVALID: .*"scope" is not an input/)
    expect(await refusal(run(runtime, "events_list", { limit: 0 }, "work"))).toMatch(/^INPUT_INVALID: /)
  })
})

describe("probe", () => {
  it("answers the account's owner, reads only get_current_user, and keeps it for the pages", async () => {
    const runtime = runtimeFor()
    const answer = await run(runtime, "probe", { source: "recordings" }, "work")
    expect(answer).toEqual({ source: "recordings", account: "work", owner: { id: "plaud:user-work", label: "Ana" }, trust: "untrusted" })
    expect(runtime.owners.get("work")).toEqual({ id: "plaud:user-work", label: "Ana" })
    expect((runtime.provider as unknown as { calls: { tool: string }[] }).calls.map((call) => call.tool)).toEqual(["get_current_user"])
  })

  it("refuses a source it does not have", async () => {
    const runtime = runtimeFor()
    expect(await refusal(run(runtime, "probe", { source: "other" }, "work"))).toMatch(/^SOURCE_UNKNOWN: /)
  })
})
