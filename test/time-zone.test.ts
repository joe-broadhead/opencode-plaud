import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderNote } from "../src/domain/export.js"
import { recordingList, recordingMeta } from "../src/domain/normalize.js"
import { line } from "../src/host/tools/recent.js"

/**
 * Plaud sends `start_at` and `created_at` as UTC with no zone, such as
 * `2026-10-31T14:05:00` (live, and Plaud's own server appends `Z`). Run under a
 * zone nine hours from UTC, so a reading as local time would be nine hours off.
 */

let saved: string | undefined

beforeAll(() => {
  saved = process.env["TZ"]
  process.env["TZ"] = "Asia/Tokyo"
})

afterAll(() => {
  if (saved === undefined) delete process.env["TZ"]
  else process.env["TZ"] = saved
})

describe("zone-less Plaud times", () => {
  it("runs in a zone that is not UTC", () => {
    expect(new Date("2026-10-31T00:00:00Z").getTimezoneOffset()).toBe(-540)
  })

  it("reads them as UTC, whatever the machine's zone", () => {
    const meta = recordingMeta({ id: "rec-3", name: "Design review", start_at: "2026-10-31T14:05:00", created_at: "2026-10-31T15:10:07.250" }, "rec-3")
    expect(meta.startedAt).toBe("2026-10-31T14:05:00.000Z")
    expect(meta.createdAt).toBe("2026-10-31T15:10:07.250Z")
  })

  it("keeps an explicit zone, and leaves a date alone", () => {
    expect(recordingMeta({ id: "a", start_at: "2026-10-31T14:05:00+01:00" }, "a").startedAt).toBe("2026-10-31T13:05:00.000Z")
    expect(recordingMeta({ id: "a", start_at: "2026-10-31T14:05:00Z" }, "a").startedAt).toBe("2026-10-31T14:05:00.000Z")
    expect(recordingMeta({ id: "a", start_at: "2026-10-31" }, "a").startedAt).toBe("2026-10-31T00:00:00.000Z")
  })

  it("shows plaud_recent's start time in UTC as Plaud recorded it", () => {
    const [recording] = recordingList({ data: [{ id: "rec-3", name: "Design review", start_at: "2026-10-31T14:05:00", duration: 3_780_000 }] })
    expect(line(recording!)).toBe("Design review · 2026-10-31 14:05 UTC · 1 h 3 min")
  })

  it("dates an export by the machine's local calendar day", () => {
    const recording = recordingMeta({ id: "rec-4", name: "Late call", start_at: "2026-10-01T20:00:00" }, "rec-4")
    const text = renderNote({ recording, tabs: [], exportedAt: new Date("2026-11-05T00:00:00Z") })
    expect(text).toContain("\ndate: 2026-10-02\n")
  })
})
