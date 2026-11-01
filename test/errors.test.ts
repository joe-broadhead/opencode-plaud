import { describe, expect, it } from "vitest"
import { fail, PlaudError } from "../src/domain/errors.js"

describe("errors", () => {
  it("carry a code, a human message and a next step", () => {
    const error = new PlaudError("EXPORT_EXISTS", "A file already exists at /tmp/a.md.", "Pass overwrite: true to replace it.")
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: "PlaudError", code: "EXPORT_EXISTS", detail: "A file already exists at /tmp/a.md.", nextStep: "Pass overwrite: true to replace it." })
    expect(error.message).toBe("EXPORT_EXISTS: A file already exists at /tmp/a.md. Next step: Pass overwrite: true to replace it.")
  })

  it("end the message with a full stop before the next step", () => {
    expect(new PlaudError("PLAUD_READ_FAILED", "plaud_get_file failed: Permission denied", "Retry.").message).toBe(
      "PLAUD_READ_FAILED: plaud_get_file failed: Permission denied. Next step: Retry.",
    )
  })

  it("are thrown by fail", () => {
    expect(() => fail("EXPORT_TIMEOUT", "Too slow.", "Raise exportTimeoutMs.")).toThrow(PlaudError)
  })
})
