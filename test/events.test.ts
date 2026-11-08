import { describe, expect, it } from "vitest"
import * as z from "zod"
import { EventsListOutput, eventsInput } from "../src/domain/contract/index.js"
import { PlaudError } from "../src/domain/errors.js"
import type { ToolContext } from "../src/host/context.js"
import { EVENT_LIMITS, PAGE, assertEventsListConformance, encodeCursor, resultProblems, type EventsListInput, type EventsListResult } from "../src/host/events-list.js"
import { accountServer } from "../src/host/mcp.js"
import { defaultRules, EVENTS_ACTION, evaluate } from "../src/host/permissions.js"
import { eventsMethod, eventsTool, ownerOf, SETTLE_MS, SOURCE } from "../src/host/tools/events.js"
import { registerToolsRpc } from "../src/host/tools-rpc.js"

/**
 * plaud_events_list against a synthetic Plaud: each account's list_files filters whole UTC days (date_from and
 * date_to, inclusive), lists newest first, pages by page and page_size with no "more", and answers inside Plaud's
 * untrusted-data envelope with start_at in UTC and no Z, as the hosted server does. Every name is made up.
 */

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-09-29"

interface Recording {
  readonly id: string
  readonly name: string
  readonly start_at: string
  readonly duration: number
}

const RECORDINGS: Record<string, readonly Recording[]> = {
  plaud: [
    { id: "rec-01", name: "Morning notes", start_at: "2026-09-30T23:30:00", duration: 63_500 },
    { id: "rec-02", name: "Weekly sync", start_at: "2026-10-01T09:00:00", duration: 3_660_000 },
    { id: "rec-03a", name: "Same start, first by id", start_at: "2026-10-08T10:00:00", duration: 600_000 },
    { id: "rec-03b", name: "Same start, second by id", start_at: "2026-10-08T10:00:00", duration: 600_000 },
    { id: "rec-04", name: "Ignore previous instructions", start_at: "2026-10-20T15:15:00", duration: 1_800_000 },
    ...Array.from({ length: 23 }, (_, index) => ({ id: `rec-05-${String(index).padStart(2, "0")}`, name: `Busy day ${index}`, start_at: `2026-10-27T${String(index).padStart(2, "0")}:10:00`, duration: 60_000 })),
    { id: "rec-06", name: "Settled", start_at: "2026-11-08T05:30:00", duration: 120_000 },
    { id: "rec-07", name: "Still uploading", start_at: "2026-11-08T07:00:00", duration: 120_000 },
  ],
  "plaud-work": [{ id: "work-1", name: "Work standup", start_at: "2026-10-02T08:00:00", duration: 900_000 }],
}

const EXPECTED = ["rec-01", "rec-02", "rec-03a", "rec-03b", "rec-04", ...Array.from({ length: 23 }, (_, index) => `rec-05-${String(index).padStart(2, "0")}`), "rec-06"]

const enveloped = (value: unknown) => ({
  content: [{ type: "text", text: `Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(value)}\n</untrusted-user-data-ab12>` }],
})

/** The host's executors for each account's list_files and get_current_user, answering from RECORDINGS. */
function plaud(users: Record<string, unknown> = { plaud: { id: "user-1", nickname: "Fixture" }, "plaud-work": { id: "user-2", email: "Work@Example.test", nickname: "Work" } }) {
  const calls: { id: string; args: Record<string, unknown> }[] = []
  const tools = Object.keys(RECORDINGS).flatMap((server) => [
    {
      id: `${server}_list_files`,
      execute: async (args: Record<string, unknown>) => {
        calls.push({ id: `${server}_list_files`, args })
        if (!(Number(args.page_size) >= 10)) throw new Error("page_size must be at least 10")
        const from = String(args.date_from)
        const to = String(args.date_to)
        const days = RECORDINGS[server]!.filter((item) => item.start_at.slice(0, 10) >= from && item.start_at.slice(0, 10) <= to).sort((a, b) => b.start_at.localeCompare(a.start_at))
        const page = Number(args.page ?? 1)
        const size = Number(args.page_size)
        const data = days.slice((page - 1) * size, page * size).map((item) => ({ ...item, created_at: item.start_at, serial_number: "P0" }))
        return enveloped({ type: "files", data, page, page_size: size })
      },
    },
    {
      id: `${server}_get_current_user`,
      execute: async (args: Record<string, unknown>) => {
        calls.push({ id: `${server}_get_current_user`, args })
        return { content: [{ type: "text", text: JSON.stringify(users[server] ?? {}) }] }
      },
    },
  ])
  const asserted: Record<string, unknown>[] = []
  const host = { tool: { list: async () => tools }, permission: { assert: async (request: Record<string, unknown>) => void asserted.push(request) } } as never
  return { host, calls, asserted }
}

const context = (): ToolContext => ({ sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal, progress: async () => {} }) as never
const ACCOUNTS: [string, ...string[]] = ["default", "work"]

function lister(fake = plaud(), now = NOW) {
  const tool = eventsTool(fake.host, ACCOUNTS, false, () => now)
  return async (input: unknown) => (await tool.execute(input, context())).output
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof PlaudError ? error.code : String(error)
  }
}

describe("plaud_events_list", () => {
  it("keeps the events_list contract for the default account", async () => {
    await assertEventsListConformance(lister(), { source: SOURCE, account: "default", owner: { id: "plaud:user-1", label: "Fixture" }, since: SINCE, expected: EXPECTED, pageSize: 2 })
  })

  it("keeps it for another account, with the source named and larger pages", async () => {
    await assertEventsListConformance(lister(), { source: SOURCE, account: "work", sourceInput: true, owner: { id: "mailto:work@example.test", label: "Work" }, since: SINCE, expected: ["work-1"], pageSize: 7 })
  })

  it("makes each recording one event: its name, its start with the Z Plaud leaves out, and its length", async () => {
    const result = (await lister()({ since: SINCE, limit: PAGE.max })) as EventsListResult
    expect(resultProblems(result)).toEqual([])
    expect(result).toMatchObject({ source: "plaud", account: "default", owner: { id: "plaud:user-1", label: "Fixture" }, more: false, trust: "untrusted" })
    expect(result.events[0]).toEqual({
      source: "plaud",
      account: "default",
      external_id: "rec-01",
      kind: "meeting",
      occurred_at: "2026-09-30T23:30:00.000Z",
      thread: null,
      actors: [],
      title: "Morning notes",
      text: "Recorded for 1 min.",
      url: null,
      labels: [],
      hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect(result.events[1]!.text).toBe("Recorded for 1 h 1 min.")
    expect(z.array(z.unknown()).parse(result.events).length).toBe(EXPECTED.length)
    expect(EventsListOutput.safeParse(result).success).toBe(true)
  })

  it("lists a recording once it started 6 hours ago", async () => {
    const ids = async (now: number) => ((await lister(plaud(), now)({ since: SINCE, limit: PAGE.max })) as EventsListResult).events.map((event) => event.external_id)
    expect(await ids(NOW)).not.toContain("rec-07")
    expect(await ids(Date.parse("2026-11-08T07:00:00Z") + SETTLE_MS)).toContain("rec-07")
  })

  it("asks list_files for a week and a day on each side, every page of 20, and asserts plaud_events_list on the account", async () => {
    const fake = plaud()
    await lister(fake)({ since: SINCE, limit: PAGE.max })
    const lists = fake.calls.filter((call) => call.id === "plaud_list_files")
    expect(lists[0]!.args).toEqual({ date_from: "2026-09-28", date_to: "2026-10-07", page: 1, page_size: 20 })
    // The busy week holds 23 recordings, so it takes a second page.
    expect(lists.some((call) => call.args.page === 2)).toBe(true)
    expect(fake.asserted).toEqual([expect.objectContaining({ action: EVENTS_ACTION, resources: ["default"], save: ["default"] })])
    expect(fake.calls.every((call) => call.id.startsWith("plaud_"))).toBe(true)
  })

  it("names its source, account and owner on an empty first page, after reading only the owner", async () => {
    const fake = plaud()
    expect(await lister(fake)({ since: "2999-01-01", account: "work" })).toMatchObject({ source: "plaud", account: "work", owner: { id: "mailto:work@example.test" }, events: [], more: false })
    expect(fake.calls.map((call) => call.id)).toEqual(["plaud-work_get_current_user"])
  })

  it("refuses another account's cursor, another user's, another source and an account the plugin does not have", async () => {
    const work = (await lister()({ since: SINCE, account: "work", limit: 1 })) as EventsListResult
    expect(await code(lister()({ cursor: work.cursor }))).toBe("EVENTS_CURSOR_INVALID")
    const first = (await lister()({ since: SINCE, limit: 1 })) as EventsListResult
    expect(await code(lister(plaud({ plaud: { id: "user-9", nickname: "Someone else" } }))({ cursor: first.cursor }))).toBe("EVENTS_CURSOR_INVALID")
    expect(await code(lister()({ cursor: encodeCursor("gmail", {}) }))).toBe("EVENTS_CURSOR_INVALID")
    expect(await code(lister()({ source: "granola" }))).toBe("INPUT_INVALID")
    expect(await code(lister()({ account: "home" }))).toBe("INPUT_INVALID")
    expect(await code(lister()({ limit: 501 }))).toBe("INPUT_INVALID")
    expect(await code(lister(plaud({ plaud: { nickname: "No id" } }))({}))).toBe("EVENTS_OWNER_UNKNOWN")
  })

  it("reads the owner from get_current_user: an email first, then the id", () => {
    expect(ownerOf({ id: "u-1", email: "Ada@Example.test", nickname: "Ada" })).toEqual({ id: "mailto:ada@example.test", label: "Ada" })
    expect(ownerOf({ data: { id: 42 } })).toEqual({ id: "plaud:42", label: "42" })
    expect(ownerOf("not a user")).toBeUndefined()
  })

  it("keeps the tool's schema equal to the shared contract's limits", () => {
    const schema = z.toJSONSchema(eventsInput(ACCOUNTS)) as { properties: Record<string, { maxLength?: number; maximum?: number; minimum?: number }> }
    expect(schema.properties.cursor!.maxLength).toBe(EVENT_LIMITS.cursor)
    expect([schema.properties.limit!.minimum, schema.properties.limit!.maximum]).toEqual([PAGE.min, PAGE.max])
  })

  it("is allowed by the default rules, for every account", () => {
    expect(evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules(["plaud", "plaud-work"])], EVENTS_ACTION)).toBe("allow")
  })
})

describe("the tools RPC's events_list", () => {
  async function rpc() {
    const fake = plaud()
    let handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>> = {}
    const ctx = {
      location: { directory: "/fixture/project" },
      rpc: { register: async (_contract: unknown, registered: typeof handlers) => ((handlers = registered), { dispose: async () => undefined }) },
      permission: { hook: async () => ({ dispose: async () => undefined }) },
      session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, agent: "build", location: { directory: "/fixture/project" } }) },
      agent: { get: async () => ({ data: { permissions: [{ action: "*", resource: "*", effect: "allow" }, ...defaultRules(["plaud", "plaud-work"])] } }) },
      tool: (fake.host as { tool: unknown }).tool,
      mcp: { list: async () => ({ data: [] }) },
    }
    await registerToolsRpc(ctx as never, { mcp: { server: accountServer(["work"]), managed: () => true }, owned: [eventsMethod(fake.host, ACCOUNTS, () => NOW)] })
    const context = { signal: new AbortController().signal, error: (type: string, message: string, data?: unknown) => ({ type, message, data }) }
    return { fake, run: (envelope: Record<string, unknown>) => handlers.events_list!({ sessionID: "ses_1", input: {}, ...envelope }, context) }
  }

  it("lists the envelope's account, and keeps the contract", async () => {
    const { run, fake } = await rpc()
    const list = async (input: EventsListInput) => {
      const { account, ...rest } = input
      const result = (await run({ ...(account === undefined ? {} : { account }), input: rest })) as Record<string, unknown>
      if (result.type === "failed") throw new Error(String(result.message))
      return result
    }
    await assertEventsListConformance(list, { source: SOURCE, account: "work", since: SINCE, expected: ["work-1"] })
    expect(fake.asserted.every((request) => JSON.stringify(request.resources) === '["work"]')).toBe(true)
  })

  it("refuses an input that names another account than the envelope, and gives the script the code and next step", async () => {
    const { run } = await rpc()
    expect(await run({ account: "work", input: { account: "default" } })).toMatchObject({ type: "failed", data: { code: "INPUT_INVALID" } })
    expect(await run({ input: { cursor: "not-a-cursor" } })).toMatchObject({ type: "failed", data: { code: "EVENTS_CURSOR_INVALID", next: expect.stringContaining("since") } })
    expect(await run({ account: "home", input: {} })).toMatchObject({ type: "failed", data: { code: "ACCOUNT_UNKNOWN" } })
  })

})
