/**
 * `fixtures/conformance.json`, replayed through the handlers.
 *
 * The fixture is the plugin's evidence to the conformance kit: two synthetic accounts, the pages they answer, their
 * probe answers and the status. This test runs every recorded case again, so a changed answer fails here instead of
 * drifting from the recording. `npm run fixtures` rebuilds it.
 */
import { readFileSync } from "node:fs"
import type { EventsListResult } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { describe, expect, it } from "vitest"
import { manifest, packageName } from "../src/manifest.js"
import { refusal, run, runtimeFor } from "./support/handlers.js"

interface RecordedCase {
  readonly input: Readonly<Record<string, unknown>>
  readonly expect?: unknown
  readonly answer?: unknown
  readonly refuses?: string
}

interface Fixture {
  readonly plugin: string
  readonly namespace: string
  readonly accounts: {
    readonly real?: boolean
    readonly aliases: readonly string[]
    readonly required: { readonly method: string; readonly code: string }
    readonly unknown: { readonly method: string; readonly account: string; readonly code: string }
    readonly cursors: readonly { readonly method: string; readonly account: string; readonly other: string; readonly code: string }[]
  }
  readonly sources: Record<string, { readonly cases?: readonly RecordedCase[]; readonly probe?: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown }; readonly snapshot?: { readonly answer: unknown } }>
  readonly events: { readonly emitted: readonly string[]; readonly status: unknown }
  readonly actions: readonly unknown[]
  readonly rpc?: { readonly inputs?: Readonly<Record<string, unknown>> }
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8")) as Fixture

/** The input a handler sees: `register` removes the account selector. */
function withoutAccount(input: Readonly<Record<string, unknown>>): { account: string; input: Record<string, unknown> } {
  const { account, ...rest } = input
  return { account: typeof account === "string" ? account : "work", input: rest }
}

describe("the recorded fixture", () => {
  it("was recorded for this package, this namespace and two synthetic aliases", () => {
    expect(fixture.plugin).toBe(packageName)
    expect(fixture.namespace).toBe(manifest.plugin.summary)
    expect(fixture.namespace.length).toBeLessThanOrEqual(400)
    expect(fixture.accounts.real).toBe(false)
    expect(fixture.accounts.aliases).toEqual(["work", "personal"])
    expect(fixture.accounts.required).toEqual({ method: "plan_export", code: "ACCOUNT_REQUIRED" })
    expect(fixture.accounts.unknown).toEqual({ method: "plan_export", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" })
    expect(fixture.accounts.cursors).toEqual([{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }])
  })

  it("declares no bus event, and the fixture records none emitted", () => {
    expect(Object.keys(manifest.events)).toEqual([])
    expect(fixture.events.emitted).toEqual([])
    expect(fixture.actions).toEqual([])
    expect(fixture.rpc?.inputs?.["plan_export"]).toEqual({ recordingId: "w-1", kind: "note" })
  })
})

describe("replaying every recorded answer", () => {
  it("answers the work and personal pages it recorded, and refuses what it recorded", async () => {
    const runtime = runtimeFor()
    const source = findSource(manifest, "plaud.recordings")!
    const cases = fixture.sources["plaud.recordings"]!.cases ?? []
    // The recording probed both aliases before its first page, so this replay does too.
    await run(runtime, "probe", withoutAccount(fixture.sources["plaud.recordings"]!.probe!.input).input, "work")
    await run(runtime, "probe", { source: "recordings" }, "personal")
    for (const item of cases) {
      const { account, input } = withoutAccount(item.input)
      if (item.refuses !== undefined) {
        expect(await refusal(run(runtime, "events_list", input, account))).toBe(item.refuses)
        continue
      }
      const answer = (await run(runtime, "events_list", input, account)) as EventsListResult
      expect(answer).toEqual(item.answer)
      expect(acceptAnswer(source, account, answer).ok).toBe(true)
    }
  })

  it("answers the recorded probe and the recorded recent snapshot", async () => {
    const runtime = runtimeFor()
    const recorded = fixture.sources["plaud.recordings"]!
    const probe = withoutAccount(recorded.probe!.input)
    expect(await run(runtime, "probe", probe.input, probe.account)).toEqual(recorded.probe!.answer)
    const snapshot = fixture.sources["plaud.recent"]!.snapshot!
    expect(await run(runtime, "recent", { limit: 3 }, "work")).toEqual(snapshot.answer)
  })

  it("answers the recorded status", async () => {
    const runtime = runtimeFor()
    await run(runtime, "probe", { source: "recordings" }, "work")
    await run(runtime, "probe", { source: "recordings" }, "personal")
    expect(await run(runtime, "status", {})).toEqual(fixture.events.status)
  })
})
