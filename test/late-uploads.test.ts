/**
 * The recordings source and a device that reaches Plaud late: `list_files` filters whole UTC days by start, and a
 * recording is visible from its upload (`created_at`). A recording that reaches Plaud after the cursor passed its start
 * is listed when it started within the lookback (14 days); one that reached Plaud later than that answers an `expired`
 * gap, once. Every name is invented.
 */
import { MAX_CURSOR_LENGTH } from "@we-the-rebel-alliance/plugin-contract/cursor"
import { resultProblems, type EventsListResult } from "@we-the-rebel-alliance/plugin-contract/events"
import { describe, expect, it } from "vitest"
import { run, runtimeFor } from "./support/handlers.js"
import type { Provider, ToolName } from "../src/provider/client.js"
import { BAND_MS, LOOKBACK_MS, SETTLE_MS } from "../src/handlers/events-list.js"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (iso: string) => Date.parse(`${iso}Z`)
const plain = (time: number) => new Date(time).toISOString().slice(0, 19)

interface Held {
  readonly id: string
  readonly name: string
  readonly start: number
  readonly upload: number
  readonly account?: string
}

/** Plaud as of `clock()`: only the recordings uploaded by then, filtered by start day, newest first. */
function heldProvider(held: Held[], clock: () => number): Provider {
  return {
    async read(_account: string, tool: ToolName, args: Readonly<Record<string, unknown>>) {
      if (tool === "get_current_user") return { data: { id: "user-work", nickname: "Ana" } }
      if (tool !== "list_files") throw new Error(`the held provider has no ${tool}`)
      const from = String(args["date_from"])
      const to = String(args["date_to"])
      const size = Number(args["page_size"])
      const page = Number(args["page"] ?? 1)
      const days = held
        .filter((item) => item.upload <= clock() && plain(item.start).slice(0, 10) >= from && plain(item.start).slice(0, 10) <= to)
        .sort((a, b) => b.start - a.start)
        .map((item) => ({ id: item.id, name: item.name, start_at: plain(item.start), created_at: plain(item.upload), duration: 60_000 }))
      return { type: "files", data: days.slice((page - 1) * size, page * size), page, page_size: size }
    },
  }
}

/** A collector: probes once, then lists with whatever cursor it holds, at the times it is given. */
async function collector(held: Held[], start: number) {
  let now = start
  const runtime = runtimeFor({ provider: heldProvider(held, () => now) as never, now: start })
  Object.defineProperty(runtime, "clock", { value: () => now, configurable: true })
  await run(runtime, "probe", { source: "recordings" }, "work")
  const list = async (input: Record<string, unknown>): Promise<EventsListResult> => (await run(runtime, "events_list", { source: "recordings", ...input }, "work")) as EventsListResult
  return {
    list,
    at: (time: number) => void (now = time),
    /** One read from `cursor`, every page of it, at `time`: the ids listed and each page's gap. */
    async read(cursor: string, time: number, limit = 100) {
      now = time
      const ids: string[] = []
      const gaps: unknown[] = []
      let page = await list({ cursor, limit })
      for (;;) {
        expect(resultProblems(page)).toEqual([])
        expect(page.cursor.length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH)
        ids.push(...page.events.map((event) => event.external_id))
        gaps.push(page.gap)
        if (!page.more) return { ids, gaps, cursor: page.cursor }
        page = await list({ cursor: page.cursor, limit })
      }
    },
  }
}

const DAY0 = at("2026-11-10T00:00:00")
const recording = (id: string, start: number, delay: number): Held => ({ id, name: `Recording ${id}`, start, upload: start + delay })

describe("recordings that reach Plaud after the cursor passed their start", () => {
  it("lists one uploaded just over 6 hours after it started, behind a later recording already listed", async () => {
    const held = [recording("a", DAY0 + 9 * HOUR, 40 * 60_000), recording("b", DAY0 + 8 * HOUR + 50 * 60_000, 6 * HOUR + 30 * 60_000)]
    const plaud = await collector(held, DAY0 + 15 * HOUR + 10 * 60_000)
    const first = await plaud.list({ since: "2026-11-10T00:00:00Z" })
    expect(first.events.map((event) => event.external_id)).toEqual(["a"])
    // b started before a, the cursor's position, and reached Plaud at 15:20, after a was listed at 15:10.
    const second = await plaud.read(first.cursor, DAY0 + 15 * HOUR + 30 * 60_000)
    expect(second).toMatchObject({ ids: ["b"], gaps: [undefined] })
    expect((await plaud.read(second.cursor, DAY0 + 20 * HOUR)).ids).toEqual([])
  })

  it("lists one uploaded 2 days after it started, once", async () => {
    const held = [recording("monday", DAY0 + 10 * HOUR, HOUR), recording("tuesday", DAY0 + DAY + 10 * HOUR, HOUR), recording("late", DAY0 + 11 * HOUR, 2 * DAY)]
    const plaud = await collector(held, DAY0 + DAY + 18 * HOUR)
    const first = await plaud.list({ since: "2026-11-10T00:00:00Z" })
    expect(first.events.map((event) => event.external_id)).toEqual(["monday", "tuesday"])
    const second = await plaud.read(first.cursor, DAY0 + 2 * DAY + 12 * HOUR)
    expect(second).toMatchObject({ ids: ["late"], gaps: [undefined] })
    expect((await plaud.read(second.cursor, DAY0 + 3 * DAY)).ids).toEqual([])
  })

  it("answers an expired gap, once, for one that reached Plaud later than the lookback, and a read from its since lists it", async () => {
    const start = DAY0
    const lateStart = DAY0 + 2 * DAY + 9 * HOUR
    const held = [...Array.from({ length: 20 }, (_, day) => recording(`daily-${day}`, start + day * DAY + 9 * HOUR, HOUR)), recording("very-late", lateStart, 17 * DAY)]
    const plaud = await collector(held, start + 18 * DAY + 20 * HOUR)
    const first = await plaud.list({ since: "2026-11-10T00:00:00Z" })
    expect(first.events.map((event) => event.external_id)).toEqual(Array.from({ length: 19 }, (_, day) => `daily-${day}`))
    const second = await plaud.read(first.cursor, start + 19 * DAY + 20 * HOUR, 1)
    expect(second.ids).toEqual(["daily-19"])
    expect(second.gaps[0]).toEqual({ reason: "expired", since: new Date(lateStart).toISOString() })
    // Once per read: no later page of it repeats the gap, and the next read says nothing more.
    expect(second.gaps.slice(1).every((gap) => gap === undefined)).toBe(true)
    expect(await plaud.read(second.cursor, start + 20 * DAY)).toMatchObject({ ids: [], gaps: [undefined] })
    // A consumer reads again from the gap's since, and finds the recording.
    plaud.at(start + 20 * DAY)
    const again = await plaud.list({ since: new Date(lateStart).toISOString(), limit: 100 })
    expect(again.events.map((event) => event.external_id)).toContain("very-late")
  })

  it("says nothing of an upload later than the lookback and the 7 days before it, which it does not read", async () => {
    const held = [...Array.from({ length: 30 }, (_, day) => recording(`daily-${day}`, DAY0 + day * DAY + 9 * HOUR, HOUR)), recording("far", DAY0 + 9 * HOUR + 30 * 60_000, 29 * DAY)]
    const plaud = await collector(held, DAY0 + 28 * DAY + 20 * HOUR)
    const cursor = (await plaud.list({ since: "2026-11-10T00:00:00Z", limit: 500 })).cursor
    expect(DAY0 + 28 * DAY + 9 * HOUR - LOOKBACK_MS - BAND_MS).toBeGreaterThan(DAY0 + 9 * HOUR + 30 * 60_000)
    expect(await plaud.read(cursor, DAY0 + 29 * DAY + 20 * HOUR)).toMatchObject({ ids: ["daily-29"], gaps: [undefined] })
  })

  it("never answers a gap for a recording before the since a listing started from", async () => {
    const held = [recording("before", DAY0 - DAY, 3 * DAY), recording("after", DAY0 + 9 * HOUR, HOUR)]
    const plaud = await collector(held, DAY0 + 20 * HOUR)
    const first = await plaud.list({ since: "2026-11-10T00:00:00Z" })
    expect(first.events.map((event) => event.external_id)).toEqual(["after"])
    expect(await plaud.read(first.cursor, DAY0 + 3 * DAY)).toMatchObject({ ids: [], gaps: [undefined] })
  })

  it("lists nothing again for a recording deleted after it was listed", async () => {
    const held = [recording("kept", DAY0 + 9 * HOUR, HOUR), recording("deleted", DAY0 + 10 * HOUR, HOUR)]
    const plaud = await collector(held, DAY0 + 20 * HOUR)
    const first = await plaud.list({ since: "2026-11-10T00:00:00Z" })
    expect(first.events.map((event) => event.external_id)).toEqual(["kept", "deleted"])
    held.splice(1, 1)
    expect(await plaud.read(first.cursor, DAY0 + DAY + 20 * HOUR)).toMatchObject({ ids: [], gaps: [undefined] })
  })

  it("keeps its cursor within 1,024 characters when 14 days hold more recordings than it can remember, and repeats none", async () => {
    const held = Array.from({ length: 14 * 24 }, (_, hour) => recording(`hourly-${String(hour).padStart(3, "0")}`, DAY0 + hour * HOUR + 5 * 60_000, 30 * 60_000))
    const plaud = await collector(held, DAY0 + 14 * DAY + 7 * HOUR)
    const listed: string[] = []
    let read = await plaud.read((await plaud.list({ since: "2026-11-10T00:00:00Z", limit: 1 })).cursor, DAY0 + 14 * DAY + 7 * HOUR)
    listed.push("hourly-000", ...read.ids)
    read = await plaud.read(read.cursor, DAY0 + 15 * DAY)
    listed.push(...read.ids)
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed.length).toBe(held.filter((item) => item.start <= DAY0 + 15 * DAY - SETTLE_MS).length)
  })
})
