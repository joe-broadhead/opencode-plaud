import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ExportOutput, exportInput } from "../src/domain/contract/index.js"

const input = exportInput(["default", "work"])

describe("plaud_export contract", () => {
  it("accepts a minimal request and every documented field", () => {
    expect(input.parse({ recordingId: "rec-1", kind: "audio" })).toEqual({ recordingId: "rec-1", kind: "audio" })
    expect(
      input.parse({ account: "work", recordingId: "rec-1", kind: "transcript", block: "outline", destination: "/tmp/plaud/a.md", overwrite: true }),
    ).toMatchObject({ account: "work", block: "outline" })
  })

  it("offers exactly the configured accounts", () => {
    expect(input.safeParse({ account: "home", recordingId: "rec-1", kind: "note" }).success).toBe(false)
    expect(JSON.stringify(z.toJSONSchema(input, { io: "input" }))).toContain('"enum":["default","work"]')
  })

  it("refuses a block outside transcripts, a relative destination, unknown kinds and unknown keys", () => {
    for (const bad of [
      { recordingId: "rec-1", kind: "audio", block: "outline" },
      { recordingId: "rec-1", kind: "note", destination: "notes/a.md" },
      { recordingId: "rec-1", kind: "video" },
      { recordingId: "", kind: "note" },
      { recordingId: "rec-1", kind: "note", planId: "plan_x" },
    ]) {
      expect(input.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("returns only the path, size and hash", () => {
    const output = { path: "/tmp/plaud/a.md", bytes: 3, sha256: "a".repeat(64) }
    expect(ExportOutput.parse(output)).toEqual(output)
    expect(ExportOutput.safeParse({ ...output, url: "https://x" }).success).toBe(false)
    expect(ExportOutput.safeParse({ ...output, sha256: "A".repeat(64) }).success).toBe(false)
  })
})
