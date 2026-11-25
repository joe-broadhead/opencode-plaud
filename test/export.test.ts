/** The export: the plan (which writes nothing), the commit (which writes one file), and the external_directory gate. */
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { refusal, run, runtimeFor } from "./support/handlers.js"
import { createFakeProvider } from "./fixtures/plaud-provider.js"
import type { Rule } from "../src/export/matcher.js"

const AUDIO_BYTES = 200_000
const SIGNATURE = "X-Amz-Signature=fake-signature"
let audio: Server
let origin: string
const roots: string[] = []

beforeAll(async () => {
  audio = createServer((request, response) => {
    if (request.url?.startsWith("/audio/")) {
      response.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(AUDIO_BYTES) })
      response.end(Buffer.alloc(AUDIO_BYTES, 7))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => audio.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(audio.address() as AddressInfo).port}`
})

afterAll(async () => {
  audio.closeAllConnections()
  await new Promise<void>((resolve) => audio.close(() => resolve()))
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup(parts: Parameters<typeof runtimeFor>[0] = {}) {
  const root = mkdtempSync(join(tmpdir(), "plaud-export-"))
  roots.push(root)
  const provider = createFakeProvider({ audioBase: origin })
  return { root, runtime: runtimeFor({ exportRoots: [root], provider, ...parts }) }
}

async function plan(runtime: ReturnType<typeof runtimeFor>, input: Record<string, unknown>) {
  return (await run(runtime, "plan_export", input, "work")) as { method: string; output: { path: string; kind: string; recordingId: string; overwrite: boolean; block?: string }; changes: string[]; trust: string }
}

async function commit(runtime: ReturnType<typeof runtimeFor>, answer: unknown, account = "work") {
  return (await run(runtime, "export", { planId: "plan_test" }, account, answer)) as { output: { path: string; bytes: number; sha256: string }; trust: string }
}

describe("plan_export", () => {
  it("names the default note, transcript and audio files, and writes nothing", async () => {
    const { root, runtime } = setup()
    const note = await plan(runtime, { recordingId: "w-1", kind: "note" })
    expect(note).toEqual({
      method: "export",
      output: { recordingId: "w-1", kind: "note", path: join(root, "note", "w-1.md"), overwrite: false },
      changes: [`Write ${join(root, "note", "w-1.md")}.`],
      trust: "untrusted",
    })
    expect((await plan(runtime, { recordingId: "w-1", kind: "transcript", block: "outline" })).output.path).toBe(join(root, "transcript", "w-1.outline.md"))
    expect((await plan(runtime, { recordingId: "w-1", kind: "audio" })).output.path).toBe(join(root, "audio", "w-1.mp3"))
    expect(existsSync(join(root, "note"))).toBe(false)
  })

  it("keeps a destination inside an export root and refuses one outside", async () => {
    const { root, runtime } = setup()
    expect((await plan(runtime, { recordingId: "w-1", kind: "note", destination: join(root, "mine.md") })).output.path).toBe(join(root, "mine.md"))
    expect(await refusal(run(runtime, "plan_export", { recordingId: "w-1", kind: "note", destination: "/etc/plaud.md" }, "work"))).toMatch(/^PERMISSION_DENIED: .* outside the export roots/)
    expect(await refusal(run(runtime, "plan_export", { recordingId: "w-1", kind: "note", destination: root }, "work"))).toMatch(/^INPUT_INVALID: .* is an export root, not a file/)
    expect(await refusal(run(runtime, "plan_export", { recordingId: "w-1", kind: "note", destination: "relative.md" }, "work"))).toMatch(/^INPUT_INVALID: the destination must be an absolute file path/)
  })

  it("refuses a block that is not a transcript's, and a recording id that is not a file name", async () => {
    const { runtime } = setup()
    expect(await refusal(run(runtime, "plan_export", { recordingId: "w-1", kind: "note", block: "outline" }, "work"))).toMatch(/^INPUT_INVALID: block is only valid for kind transcript/)
    expect(await refusal(run(runtime, "plan_export", { recordingId: "../escape", kind: "note" }, "work"))).toMatch(/^INPUT_INVALID: the recording id cannot be used as a file name/)
  })
})

describe("export", () => {
  it("writes a note as Markdown, with its size and hash", async () => {
    const { root, runtime } = setup()
    const answer = await commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note" }))
    const path = join(root, "note", "w-1.md")
    expect(answer).toEqual({ output: { path, bytes: Buffer.byteLength(readFileSync(path)), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }, trust: "untrusted" })
    const text = readFileSync(path, "utf8")
    expect(text).toContain('name: "Weekly sync"')
    expect(text).toContain("## Summary\n\n- Ship on Friday.")
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, "note")).mode & 0o777).toBe(0o700)
  })

  it("writes every transcript page it reads", async () => {
    const { root, runtime } = setup()
    const answer = await commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "transcript" }))
    expect(answer.output.path).toBe(join(root, "transcript", "w-1.transaction.md"))
    const text = readFileSync(answer.output.path, "utf8")
    expect(text).toContain("- [00:00:00] Alice: Hello.")
    expect(text).toContain("- [00:01:01] Bob: Bye.")
    expect(text).toContain("- [00:02:00] Alice: One more thing.")
  })

  it("downloads the audio, streams it to the file and hashes it", async () => {
    const { root, runtime } = setup()
    const answer = await commit(runtime, await plan(runtime, { recordingId: "w-2", kind: "audio" }))
    expect(answer.output).toEqual({ path: join(root, "audio", "w-2.mp3"), bytes: AUDIO_BYTES, sha256: createHash("sha256").update(Buffer.alloc(AUDIO_BYTES, 7)).digest("hex") })
    expect(readFileSync(answer.output.path).length).toBe(AUDIO_BYTES)
  })

  it("refuses an existing file without overwrite, and replaces it with overwrite", async () => {
    const { root, runtime } = setup()
    const first = await plan(runtime, { recordingId: "w-1", kind: "note" })
    await commit(runtime, first)
    expect(await refusal(commit(runtime, first))).toMatch(/^INPUT_INVALID: a file already exists/)
    const again = await commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note", overwrite: true }))
    expect(again.output.path).toBe(join(root, "note", "w-1.md"))
  })

  it("refuses a plan that names no file this commit writes", async () => {
    const { runtime } = setup()
    expect(await refusal(run(runtime, "export", { planId: "x" }, "work", { method: "export", output: {} }))).toMatch(/^PLAN_INVALID: /)
  })
})

describe("the external_directory gate", () => {
  const outside = () => {
    const root = mkdtempSync(join(tmpdir(), "plaud-project-"))
    roots.push(root)
    return root
  }

  it("writes inside the project without asking for a rule", async () => {
    const { root, runtime } = setup()
    expect((await commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note" }))).output.path).toBe(join(root, "note", "w-1.md"))
  })

  it.each([
    ["agent", "deny"],
    ["agent", "ask"],
    ["session", "deny"],
    ["session", "ask"],
  ] as const)("refuses on an %s rule that %ss the folder, and asks nobody", async (who, effect) => {
    const { root } = setup()
    const project = outside()
    const folder = join(root, "note")
    const rule: Rule = { action: "external_directory", resource: `${folder}/*`, effect }
    const runtime = runtimeFor({
      exportRoots: [root],
      provider: createFakeProvider({ audioBase: origin }),
      location: { directory: project, project: { directory: project } },
      agentRules: async () => (who === "agent" ? [rule] : []),
      sessionRules: async () => (who === "session" ? [rule] : []),
    })
    expect(await refusal(commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note" })))).toMatch(/^PERMISSION_DENIED: the export folder is outside the project/)
    expect(existsSync(folder)).toBe(false)
  })

  it("writes outside the project when an agent or session rule allows the folder", async () => {
    for (const who of ["agent", "session"] as const) {
      const { root } = setup()
      const project = outside()
      const folder = join(root, "note")
      const rule: Rule = { action: "external_directory", resource: `${folder}/*`, effect: "allow" }
      const runtime = runtimeFor({
        exportRoots: [root],
        provider: createFakeProvider({ audioBase: origin }),
        location: { directory: project, project: { directory: project } },
        agentRules: async () => (who === "agent" ? [rule] : []),
        sessionRules: async () => (who === "session" ? [rule] : []),
      })
      expect((await commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note" }))).output.path).toBe(join(folder, "w-1.md"))
    }
  })

  it("refuses a session on a workspace, where the files are on another machine", async () => {
    const { root } = setup()
    const runtime = runtimeFor({ exportRoots: [root], provider: createFakeProvider({ audioBase: origin }), location: { directory: root, project: { directory: root }, workspaceID: "ws-1" } })
    expect(await refusal(commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "note" })))).toMatch(/^UNAVAILABLE: the export runs in a workspace session/)
  })

  it("refuses a symlink inside a root that leads out of it", async () => {
    const { root } = setup()
    const target = mkdtempSync(join(tmpdir(), "plaud-outside-"))
    roots.push(target)
    symlinkSync(target, join(root, "esc"))
    const answer = await plan(runtimeFor({ exportRoots: [root], provider: createFakeProvider({ audioBase: origin }) }), { recordingId: "w-1", kind: "note", destination: join(root, "esc", "w-1.md") })
    expect(await refusal(commit(runtimeFor({ exportRoots: [root], provider: createFakeProvider({ audioBase: origin }) }), answer))).toMatch(/^PERMISSION_DENIED: /)
    expect(existsSync(join(target, "w-1.md"))).toBe(false)
  })

  it("never names a signed audio link in a refusal", async () => {
    const { root } = setup()
    const project = outside()
    const runtime = runtimeFor({ exportRoots: [root], provider: createFakeProvider({ audioBase: origin }), location: { directory: project, project: { directory: project } } })
    const message = await refusal(commit(runtime, await plan(runtime, { recordingId: "w-1", kind: "audio" })))
    expect(message).not.toContain(SIGNATURE)
    expect(message).toMatch(/^PERMISSION_DENIED: /)
  })
})

describe("the local action", () => {
  it("is the manifest's only action, with effect local", async () => {
    const { default: pkg } = (await import("../package.json", { with: { type: "json" } })) as { default: { capabilities: { actions: { id: string; effect: string; preview: string; commit: string }[] } } }
    expect(pkg.capabilities.actions).toEqual([{ id: "plaud.export", effect: "local", preview: "plan_export", commit: "export", input: expect.anything(), output: expect.anything() }])
  })

  it("writes the exact file the plan showed", async () => {
    const { runtime } = setup()
    const answer = await plan(runtime, { recordingId: "w-1", kind: "note", destination: undefined })
    const written = await commit(runtime, answer)
    expect(written.output.path).toBe(answer.output.path)
    writeFileSync(join(runtime.location.directory, ".keep"), "")
  })
})
