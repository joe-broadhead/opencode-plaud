import { describe, expect, it } from "vitest"
import { DISPLAY_NAME, displayName, signInStep } from "../src/domain/auth.js"

describe("/connect names", () => {
  it("are Plaud for the default account and Plaud (<alias>) for the others", () => {
    expect(DISPLAY_NAME).toBe("Plaud")
    expect(displayName("default")).toBe("Plaud")
    expect(displayName("work")).toBe("Plaud (work)")
  })
})

describe("sign-in remedy", () => {
  it("sends the user to /connect, where o or Enter opens the sign-in page", () => {
    expect(signInStep("default")).toBe("Run /connect and choose Plaud, then press o or Enter to open the sign-in page.")
    expect(signInStep("work")).toBe("Run /connect and choose Plaud (work), then press o or Enter to open the sign-in page.")
  })
})
