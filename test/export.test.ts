import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../src/host/context.js"
import { NAMESPACE, registerTools, type ToolOptions, type ToolsHost } from "../src/host/tools/index.js"

/**
 * plaud_export against a narrow fake host: the permission assertion, the
 * host's Plaud MCP executors from tool.list(), and a stubbed fetch for the
 * signed audio link. The filesystem is real, under a temporary directory.
 */

const SECRET = "X-Amz-Signature=SECRET"
const AUDIO_URL = `https://audio.plaud.test/files/rec-1.mp3?${SECRET}`
const FILE = {
  id: "rec-1",
  name: "Weekly sync",
  created_at: "2026-10-01T09:00:00.000Z",
  start_at: "2026-10-01T09:00:00.000Z",
  duration: 3_600_000,
  presigned_url: AUDIO_URL,
}
const PAGES: Record<string, unknown> = {
  first: { segments: [{ speaker: "Alice", start_time: 0, end_time: 4_700, content: "Hello." }], next_cursor: "cur_2" },
  cur_2: { segments: [{ speaker: "Bob", start_time: 61_000, end_time: 63_500, content: "Bye." }], next_cursor: null },
}
const NOTES = [{ data_type: "auto_sum_note", data_tab_name: "AI summary", data_title: "Weekly sync", data_content: "- Ship on Friday.", data_error_code: 0 }]

type Executor = (args: Record<string, unknown>) => Promise<unknown>
type Tool = { input: { "~standard": { validate(value: unknown): unknown } }; execute(input: unknown, context: ToolContext): Promise<{ output: unknown }> }

let dir: string
let roots: string[]

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "plaud-export-test-")))
  roots = [join(dir, "Plaud"), join(dir, "Second")]
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

function json(value: unknown) {
  return { output: value, content: [{ type: "text", text: JSON.stringify(value) }] }
}

/** The host's Plaud tools, keyed by tool id, answering like the hosted server. */
function plaudTools(servers = ["plaud", "plaud-work"]): Record<string, Executor> {
  return Object.fromEntries(
    servers.flatMap((server) => [
      [`${server}_get_file`, async () => json(FILE)],
      [`${server}_get_transcript`, async (args: Record<string, unknown>) => json(PAGES[(args["cursor"] as string | undefined) ?? "first"])],
      [`${server}_get_note`, async () => json(NOTES)],
    ]),
  )
}

function fakeHost(options: { tools?: Record<string, Executor>; assert?: (request: unknown) => Promise<void>; settings?: Partial<ToolOptions> } = {}) {
  const executors = options.tools ?? plaudTools()
  const calls: { id: string; args: Record<string, unknown>; signal: AbortSignal }[] = []
  const assert = vi.fn(options.assert ?? (async () => undefined))
  const added: unknown[] = []
  const namespaces: unknown[] = []
  const hooks: string[] = []
  const disposed: string[] = []
  const ctx: ToolsHost = {
    tool: {
      transform: async (callback) => {
        callback({ namespace: (value: unknown) => namespaces.push(value), add: (tool: unknown) => added.push(tool) } as never)
        return { dispose: async () => void disposed.push("tools") }
      },
      hook: (async (name: string) => {
        hooks.push(name)
        return { dispose: async () => void disposed.push("hook") }
      }) as ToolsHost["tool"]["hook"],
      list: async () =>
        Object.entries(executors).map(([id, execute]) => ({
          id,
          name: id,
          description: "",
          input: { type: "object" },
          execute: async (args: Record<string, unknown>, context: ToolContext) => {
            calls.push({ id, args, signal: context.signal })
            return execute(args)
          },
        })) as never,
    },
    permission: { assert },
  }
  const settings: ToolOptions = {
    accounts: ["work"],
    exportRoots: roots,
    maxAudioBytes: 1024 * 1024,
    maxTextBytes: 1024 * 1024,
    exportTimeoutMs: 30 * 60 * 1000,
    ...options.settings,
  }
  return { ctx, settings, calls, assert, added, namespaces, hooks, disposed }
}

async function exporter(options: Parameters<typeof fakeHost>[0] = {}) {
  const host = fakeHost(options)
  const registration = await registerTools(host.ctx, host.settings)
  const tool = host.added[0] as Tool
  const progress = vi.fn(async (_update: Record<string, unknown>) => undefined)
  /** Validates like the host, then runs the export with a tool context. */
  const run = async (input: unknown, signal = new AbortController().signal) => {
    const parsed = (await tool.input["~standard"].validate(input)) as { value?: unknown; issues?: unknown }
    if (parsed.issues) throw new Error(`invalid input: ${JSON.stringify(parsed.issues)}`)
    const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal, progress } as unknown as ToolContext
    return (await tool.execute(parsed.value, context)).output as { path: string; bytes: number; sha256: string }
  }
  return { ...host, registration, tool, run, progress }
}

function audioResponse(bytes: Uint8Array, headers: Record<string, string> = { "content-type": "audio/mpeg" }) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(bytes, { headers }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex")

/** Every entry below `dir`, so a test can prove nothing else was written. */
async function tree(root = dir): Promise<string[]> {
  const entries = await readdir(root, { recursive: true }).catch(() => [] as string[])
  return entries.map(String).sort()
}

describe("registration", () => {
  it("registers exactly one tool, plaud_export, pinned in the plaud namespace, plus the signed-link hook", async () => {
    const { added, namespaces, hooks, registration, disposed } = await exporter()
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ name: "export", options: { namespace: "plaud", pinned: true } })
    expect((added[0] as { description: string }).description).toContain(roots.join(", "))
    expect(namespaces).toEqual([NAMESPACE])
    expect(hooks).toEqual(["execute.after"])
    await registration.dispose()
    expect(disposed).toEqual(["hook", "tools"])
  })
})

describe("one-step export", () => {
  it("exports audio after one permission assertion, into folders it creates", async () => {
    const audio = new Uint8Array(300_000).map((_, index) => index % 251)
    const fetch = audioResponse(audio, { "content-type": "audio/mpeg", "content-length": String(audio.byteLength) })
    const { run, assert, calls } = await exporter()

    const result = await run({ recordingId: "rec-1", kind: "audio" })

    const path = join(roots[0]!, "audio", "rec-1.mp3")
    expect(result).toEqual({ path, bytes: audio.byteLength, sha256: sha256(audio) })
    expect(new Uint8Array(await readFile(path))).toEqual(audio)
    expect(assert).toHaveBeenCalledOnce()
    expect(assert.mock.calls[0]![0]).toEqual({
      sessionID: "ses_1",
      agent: "build",
      action: "plaud_export",
      resources: ["default:audio"],
      save: ["default:audio"],
      metadata: { account: "default", kind: "audio", recordingId: "rec-1", destination: `${join(roots[0]!, "audio")}/`, overwrite: false },
      source: { type: "tool", messageID: "msg_1", id: "call_1" },
    })
    expect(calls.map((call) => [call.id, call.args])).toEqual([["plaud_get_file", { file_id: "rec-1" }]])
    expect(fetch.mock.calls[0]).toEqual([AUDIO_URL, expect.objectContaining({ redirect: "manual" })])
    expect((await stat(roots[0]!)).mode & 0o777).toBe(0o700)
    expect((await stat(join(roots[0]!, "audio"))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await tree()).toEqual(["Plaud", "Plaud/audio", "Plaud/audio/rec-1.mp3"])
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it("names audio from the content type when the link has no extension", async () => {
    audioResponse(new Uint8Array([1, 2, 3]), { "content-type": "audio/ogg; codecs=opus" })
    const tools = { ...plaudTools(), plaud_get_file: async () => json({ ...FILE, presigned_url: `https://audio.plaud.test/raw?${SECRET}` }) }
    const { run } = await exporter({ tools })
    expect((await run({ recordingId: "rec-1", kind: "audio" })).path).toBe(join(roots[0]!, "audio", "rec-1.ogg"))
  })

  it("exports every transcript page of another account as Markdown", async () => {
    const { run, assert, calls } = await exporter()
    const result = await run({ account: "work", recordingId: "rec-1", kind: "transcript" })

    const text = await readFile(result.path, "utf8")
    expect(result).toEqual({ path: join(roots[0]!, "transcript", "rec-1.transaction.md"), bytes: Buffer.byteLength(text), sha256: sha256(text) })
    expect(text).toContain('recording_id: "rec-1"\nname: "Weekly sync"\n')
    expect(text).toContain("duration_ms: 3600000\nkind: transcript\nblock: transaction\n")
    expect(text).toContain("- [00:00:00] Alice: Hello.\n- [00:01:01] Bob: Bye.\n")
    expect(assert.mock.calls[0]![0]).toMatchObject({ resources: ["work:transcript"], save: ["work:transcript"], metadata: { account: "work", block: "transaction" } })
    expect(calls.map((call) => [call.id, call.args])).toEqual([
      ["plaud-work_get_file", { file_id: "rec-1" }],
      ["plaud-work_get_transcript", { file_id: "rec-1", block: "transaction" }],
      ["plaud-work_get_transcript", { file_id: "rec-1", block: "transaction", cursor: "cur_2" }],
    ])
  })

  it("exports the note tabs to an explicit destination, creating its folders inside a root", async () => {
    const { run } = await exporter()
    const destination = join(roots[1]!, "meetings", "2026", "sync.md")
    const result = await run({ recordingId: "rec-1", kind: "note", destination })
    expect(result.path).toBe(destination)
    expect(await readFile(destination, "utf8")).toContain("# Note\n\n## AI summary\n\n- Ship on Friday.\n")
    expect(await tree()).toEqual(["Second", "Second/meetings", "Second/meetings/2026", "Second/meetings/2026/sync.md"])
  })

  it("gives each transcript block of a recording its own default file, so a second block does not collide", async () => {
    const { run } = await exporter()
    const polished = await run({ recordingId: "rec-1", kind: "transcript", block: "transaction_polish" })
    const outline = await run({ recordingId: "rec-1", kind: "transcript", block: "outline" })
    expect(polished.path).toBe(join(roots[0]!, "transcript", "rec-1.transaction_polish.md"))
    expect(outline.path).toBe(join(roots[0]!, "transcript", "rec-1.outline.md"))
    expect((await readdir(join(roots[0]!, "transcript"))).sort()).toEqual(["rec-1.outline.md", "rec-1.transaction_polish.md"])
    expect(await readFile(outline.path, "utf8")).toContain("block: outline\n")
  })

  it("exports the outline as topics at their offsets, not as JSON", async () => {
    const outline = { segments: [{ start_time: 0, end_time: 300_000, topic: "Launch checklist" }, { start_time: 3_723_000, end_time: 3_900_000, topic: "Pricing" }], next_cursor: null }
    const { run } = await exporter({ tools: { ...plaudTools(), plaud_get_transcript: async () => json(outline) } })
    const text = await readFile((await run({ recordingId: "rec-1", kind: "transcript", block: "outline" })).path, "utf8")
    expect(text).toContain("# Transcript\n\n## Outline\n\n- [00:00:00] Launch checklist\n- [01:02:03] Pricing\n")
    expect(text).not.toContain("{")
  })

  it("names note tabs by data_tab_name and says which tab Plaud could not load", async () => {
    const notes = [...NOTES, { ...NOTES[0], data_type: "custom_note", data_tab_name: "Decisions", data_content: "", data_error_code: 3 }]
    const { run } = await exporter({ tools: { ...plaudTools(), plaud_get_note: async () => json(notes) } })
    const text = await readFile((await run({ recordingId: "rec-1", kind: "note" })).path, "utf8")
    expect(text).toContain("## AI summary\n\n- Ship on Friday.\n\n## Decisions\n\n_Plaud could not load this tab (error code 3)._\n")
  })

  it("reports progress while streaming audio", async () => {
    audioResponse(new Uint8Array(10))
    const { run, progress } = await exporter()
    await run({ recordingId: "rec-1", kind: "audio" })
    expect(progress).toHaveBeenCalledWith({ phase: "audio", bytes: 10 })
  })
})

describe("refusals", () => {
  it("refuses a destination outside the roots before asking or reading", async () => {
    const { run, assert, calls } = await exporter()
    await expect(run({ recordingId: "rec-1", kind: "note", destination: join(dir, "elsewhere", "a.md") })).rejects.toThrow(
      /^EXPORT_OUTSIDE_ROOTS: .*elsewhere\/a\.md is outside the export roots .* Next step: Choose a destination inside an export root/,
    )
    await expect(run({ recordingId: "rec-1", kind: "note", destination: `${roots[0]}-sibling/a.md` })).rejects.toThrow(/EXPORT_OUTSIDE_ROOTS/)
    expect(assert).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(await tree()).toEqual([])
  })

  it("refuses a folder inside a root that links out of the roots, writing nothing through it", async () => {
    const outside = join(dir, "outside")
    await mkdir(join(roots[0]!), { recursive: true })
    await mkdir(outside)
    await symlink(outside, join(roots[0]!, "escape"))
    const { run } = await exporter()
    await expect(run({ recordingId: "rec-1", kind: "note", destination: join(roots[0]!, "escape", "deeper", "a.md") })).rejects.toThrow(
      /^EXPORT_OUTSIDE_ROOTS:/,
    )
    expect(await readdir(outside)).toEqual([])
  })

  it("refuses to replace an existing file unless overwrite is true", async () => {
    const existing = join(roots[0]!, "note", "rec-1.md")
    await mkdir(join(roots[0]!, "note"), { recursive: true })
    await writeFile(existing, "keep me")
    const { run } = await exporter()
    await expect(run({ recordingId: "rec-1", kind: "note" })).rejects.toThrow(
      `EXPORT_EXISTS: A file already exists at ${existing}. Next step: Pass overwrite: true to replace it, or choose another destination.`,
    )
    expect(await readFile(existing, "utf8")).toBe("keep me")
    expect(await readdir(join(roots[0]!, "note"))).toEqual(["rec-1.md"])

    await run({ recordingId: "rec-1", kind: "note", overwrite: true })
    expect(await readFile(existing, "utf8")).toContain("# Note")
    expect(await readdir(join(roots[0]!, "note"))).toEqual(["rec-1.md"])
  })

  it("refuses a folder or a root as the destination file", async () => {
    await mkdir(join(roots[0]!, "folder"), { recursive: true })
    const { run } = await exporter()
    await expect(run({ recordingId: "rec-1", kind: "note", destination: join(roots[0]!, "folder"), overwrite: true })).rejects.toThrow(
      /^EXPORT_BAD_DESTINATION: .*folder is a folder/,
    )
    await expect(run({ recordingId: "rec-1", kind: "note", destination: roots[1]! })).rejects.toThrow(/^EXPORT_BAD_DESTINATION:/)
  })

  it("rethrows a declined prompt untouched and writes nothing", async () => {
    const declined = Object.assign(new Error(""), { name: "Permission.DeclinedError" })
    const { run, calls } = await exporter({ assert: async () => Promise.reject(declined) })
    const failure = await run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)
    expect(failure).toBe(declined)
    expect(calls).toEqual([])
    expect(await tree()).toEqual([])
  })

  it("reports a denied read as an export error with the next step", async () => {
    const tools = { ...plaudTools(), plaud_get_file: async () => Promise.reject(new Error("Permission denied: plaud_get_file")) }
    const { run } = await exporter({ tools })
    await expect(run({ recordingId: "rec-1", kind: "note" })).rejects.toThrow(
      "PLAUD_READ_FAILED: plaud_get_file failed: Permission denied: plaud_get_file. Next step: If a permission rule denies plaud_get_file, allow it for this agent;",
    )
    expect(await tree()).toEqual([])
  })

  it("rethrows a read whose prompt was declined untouched", async () => {
    const declined = new Error("")
    const tools = { ...plaudTools(), plaud_get_file: async () => Promise.reject(declined) }
    const { run } = await exporter({ tools })
    expect(await run({ recordingId: "rec-1", kind: "note" }).catch((error: unknown) => error)).toBe(declined)
  })

  it("names the sign-in step when the account's server is not connected", async () => {
    const { run } = await exporter({ tools: plaudTools(["plaud"]) })
    await expect(run({ account: "work", recordingId: "rec-1", kind: "note" })).rejects.toThrow(
      "AUTH_REQUIRED: The plaud-work server is not connected or not signed in, so plaud-work_get_file is unavailable. Next step: Run /connect and choose Plaud (work), then press o or Enter to open the sign-in page.",
    )
  })

  it("reports audio Plaud does not have yet, and refuses a link that is not https without fetching it", async () => {
    const fetch = audioResponse(new Uint8Array(1))
    const missing = await exporter({ tools: { ...plaudTools(), plaud_get_file: async () => json({ ...FILE, presigned_url: undefined }) } })
    await expect(missing.run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(/^CONTENT_UNAVAILABLE: Plaud has no audio/)
    const local = await exporter({ tools: { ...plaudTools(), plaud_get_file: async () => json({ ...FILE, presigned_url: "file:///etc/passwd" }) } })
    await expect(local.run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(/^PLAUD_UNREADABLE: Plaud returned an audio link that is not a valid https URL\./)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("refuses an audio link that does not parse with a code and a next step, never the link (PLAUD-1)", async () => {
    const fetch = audioResponse(new Uint8Array(1))
    const tools = { ...plaudTools(), plaud_get_file: async () => json({ ...FILE, presigned_url: `https://[audio.plaud.test/rec-1.mp3?${SECRET}` }) }
    const failure = (await (await exporter({ tools })).run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error & { code?: unknown }
    expect(failure.message).toBe(
      "PLAUD_UNREADABLE: Plaud returned an audio link that is not a valid https URL. Next step: Retry later; if it still fails, report it to the plugin's maintainers.",
    )
    expect(failure.code).toBe("PLAUD_UNREADABLE")
    expect(JSON.stringify({ ...failure, stack: failure.stack })).not.toContain(SECRET)
    expect(fetch).not.toHaveBeenCalled()
    expect(await tree()).toEqual([])
  })

  it("refuses an audio link with credentials in it", async () => {
    const fetch = audioResponse(new Uint8Array(1))
    const tools = { ...plaudTools(), plaud_get_file: async () => json({ ...FILE, presigned_url: `https://user:pass@audio.plaud.test/rec-1.mp3?${SECRET}` }) }
    await expect((await exporter({ tools })).run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(/^PLAUD_UNREADABLE: Plaud returned an audio link that is not a valid https URL\./)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("reports a missing transcript block", async () => {
    const tools = { ...plaudTools(), plaud_get_transcript: async () => json('Block "outline" not available for this recording.') }
    const { run } = await exporter({ tools })
    await expect(run({ recordingId: "rec-1", kind: "transcript", block: "outline" })).rejects.toThrow(/^CONTENT_UNAVAILABLE: Plaud has no outline block/)
    expect(await tree()).toEqual(["Plaud", "Plaud/transcript"])
  })

  it("never puts the audio link in an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })))
    const { run } = await exporter()
    const failure = (await run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error
    expect(failure.message).toMatch(/^EXPORT_FAILED: Plaud's audio server refused the download \(HTTP 403\)\./)
    expect(failure.message).not.toContain("audio.plaud.test")

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError(`fetch failed for ${AUDIO_URL}`))))
    const offline = (await run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error
    expect(offline.message).toMatch(/^EXPORT_FAILED: The audio download could not start\./)
    expect(offline.message).not.toContain(SECRET)

    const tools = { ...plaudTools(), plaud_get_file: async () => Promise.reject(new Error(`upstream said ${AUDIO_URL}`)) }
    const echoed = (await (await exporter({ tools })).run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error
    expect(echoed.message).toContain("upstream said [url withheld]")
    expect(echoed.message).not.toContain(SECRET)
  })
})

/**
 * A fetch that answers from a table by URL and, like Node's own, follows redirects itself unless the call says
 * `redirect: "manual"`. Every URL it was asked for is recorded.
 */
function web(routes: Record<string, () => Response>) {
  const asked: string[] = []
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    let url = String(input)
    for (let hops = 0; hops < 20; hops++) {
      asked.push(url)
      const response = routes[url]?.() ?? new Response("missing", { status: 404 })
      const location = response.headers.get("location")
      if (init?.redirect === "manual" || location === null || response.status < 300 || response.status > 399) return response
      url = new URL(location, url).href
    }
    throw new TypeError("redirect count exceeded")
  })
  vi.stubGlobal("fetch", fetch)
  return { fetch, asked }
}

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } })
const audio = (bytes: string) => () => new Response(bytes, { headers: { "content-type": "audio/mpeg" } })

describe("redirects of the audio link (PLAUD-2)", () => {
  it("follows https redirects, relative ones too, and names the file from Plaud's link", async () => {
    const cdn = `https://cdn.plaud.test/a/b?${SECRET}`
    const { asked } = web({ [AUDIO_URL]: redirect(cdn, 307), [cdn]: redirect(`/final?${SECRET}`, 301), [`https://cdn.plaud.test/final?${SECRET}`]: audio("RIFF") })
    const result = await (await exporter()).run({ recordingId: "rec-1", kind: "audio" })
    expect(result.path).toBe(join(roots[0]!, "audio", "rec-1.mp3"))
    expect(await readFile(result.path, "utf8")).toBe("RIFF")
    expect(asked).toEqual([AUDIO_URL, cdn, `https://cdn.plaud.test/final?${SECRET}`])
  })

  it.each([
    ["plain http", `http://cdn.plaud.test/rec-1.mp3?${SECRET}`],
    ["a link with credentials", `https://user:pass@cdn.plaud.test/rec-1.mp3?${SECRET}`],
    ["this machine", `http://127.0.0.1:9/rec-1.mp3?${SECRET}`],
    ["another scheme", `file:///etc/passwd?${SECRET}`],
    ["a location that does not parse", `https://[cdn.plaud.test/rec-1.mp3?${SECRET}`],
  ])("refuses a redirect to %s before fetching it, writes nothing, and never names the link", async (_name, target) => {
    const { asked } = web({ [AUDIO_URL]: redirect(target), [target]: audio("stolen") })
    const failure = (await (await exporter()).run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error
    expect(failure.message).toBe(
      "PLAUD_UNREADABLE: Plaud's audio link redirected to an address that is not a valid https URL. Next step: Retry later; if it still fails, report it to the plugin's maintainers.",
    )
    expect(failure.message).not.toContain("plaud.test")
    expect(asked).toEqual([AUDIO_URL])
    expect(await tree()).toEqual([])
  })

  it("refuses a redirect without a location, and a chain longer than five", async () => {
    web({ [AUDIO_URL]: () => new Response(null, { status: 302 }) })
    await expect((await exporter()).run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(/^PLAUD_UNREADABLE: Plaud's audio link redirected to an address that is not a valid https URL\./)

    const hop = (n: number) => `https://cdn.plaud.test/${n}?${SECRET}`
    const { asked } = web({ [AUDIO_URL]: redirect(hop(1)), ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [hop(n), redirect(hop(n + 1))])) })
    const failure = (await (await exporter()).run({ recordingId: "rec-1", kind: "audio" }).catch((error: unknown) => error)) as Error
    expect(failure.message).toBe("PLAUD_UNREADABLE: Plaud's audio link redirected more than 5 times. Next step: Retry later; if it still fails, report it to the plugin's maintainers.")
    expect(asked).toHaveLength(6)
    expect(await tree()).toEqual([])
  })
})

describe("size caps", () => {
  it("refuses audio whose declared size is over the cap before writing", async () => {
    audioResponse(new Uint8Array(10), { "content-length": "2000" })
    const { run } = await exporter({ settings: { maxAudioBytes: 1000 } })
    await expect(run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(
      "EXPORT_TOO_LARGE: The audio is 2000 bytes, over maxAudioBytes (1000). Next step: Raise the maxAudioBytes plugin option.",
    )
    expect(await tree()).toEqual([])
  })

  it("stops a stream that grows past the cap and removes the staging file", async () => {
    const chunks = [new Uint8Array(600), new Uint8Array(600)]
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull: (controller) => void (chunks.length > 0 ? controller.enqueue(chunks.shift()!) : controller.close()) }))))
    const { run } = await exporter({ settings: { maxAudioBytes: 1000 } })
    await expect(run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(/^EXPORT_TOO_LARGE: The audio grew past maxAudioBytes \(1000\)/)
    expect(await tree()).toEqual(["Plaud", "Plaud/audio"])
  })

  it("refuses Markdown over the text cap", async () => {
    const { run } = await exporter({ settings: { maxTextBytes: 100 } })
    await expect(run({ recordingId: "rec-1", kind: "transcript" })).rejects.toThrow(/^EXPORT_TOO_LARGE: The transcript is \d+ bytes, over maxTextBytes \(100\)/)
    expect(await tree()).toEqual(["Plaud", "Plaud/transcript"])
  })
})

describe("time budget", () => {
  it("finishes an audio download that streams for more than 120 s within exportTimeoutMs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    const started = Date.now()
    let sent = 0
    // True while the stream waits on its (fake) 10 s timer for the next chunk.
    let waiting = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            pull: (controller) =>
              new Promise<void>((resolve) => {
                waiting = true
                setTimeout(() => {
                  waiting = false
                  if (sent === 13) controller.close()
                  else controller.enqueue(new Uint8Array(1000).fill(++sent))
                  resolve()
                }, 10_000)
              }),
          }),
        ),
      ),
    )
    const { run, progress } = await exporter({ settings: { exportTimeoutMs: 30 * 60 * 1000 } })
    let settled = false
    const pending = run({ recordingId: "rec-1", kind: "audio" }).finally(() => (settled = true))
    // Move the fake clock only while the stream waits on it. Otherwise yield, so the export's real file writes can
    // finish: a fixed number of steps raced those writes and ran out on slow runners, leaving a timer never advanced.
    const deadline = performance.now() + 20_000
    while (!settled && performance.now() < deadline) {
      if (waiting) await vi.advanceTimersByTimeAsync(10_000)
      else await new Promise((resolve) => setImmediate(resolve))
    }
    expect(settled).toBe(true)
    const result = await pending
    expect(Date.now() - started).toBeGreaterThan(120_000)
    expect(result.bytes).toBe(13_000)
    expect((await readFile(result.path)).subarray(12_000)).toEqual(Buffer.alloc(1000, 13))
    // Reports are throttled to one a second, so their count depends on how the stream queues chunks.
    const reported = progress.mock.calls.map(([update]) => update["bytes"] as number)
    expect(reported.length).toBeGreaterThan(1)
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
  })

  it("stops a stalled export at exportTimeoutMs and leaves no file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined) }))))
    const { run } = await exporter({ settings: { exportTimeoutMs: 200 } })
    await expect(run({ recordingId: "rec-1", kind: "audio" })).rejects.toThrow(
      "EXPORT_TIMEOUT: The export did not finish within exportTimeoutMs (200 ms). Next step: Raise the exportTimeoutMs plugin option, or retry on a faster connection.",
    )
    expect(await tree()).toEqual(["Plaud", "Plaud/audio"])
  })

  it("passes its budget to the host's Plaud reads", async () => {
    const tools = { ...plaudTools(), plaud_get_note: () => new Promise<unknown>(() => undefined) }
    const { run, calls } = await exporter({ tools, settings: { exportTimeoutMs: 200 } })
    await expect(run({ recordingId: "rec-1", kind: "note" })).rejects.toThrow(/^EXPORT_TIMEOUT:/)
    expect(calls.at(-1)?.signal.aborted).toBe(true)
  })

  it("rethrows the caller's cancellation without writing", async () => {
    const controller = new AbortController()
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort(new Error("cancelled by the user"))
      init?.signal?.throwIfAborted()
      return new Response(new Uint8Array(1))
    }))
    const { run } = await exporter()
    await expect(run({ recordingId: "rec-1", kind: "audio" }, controller.signal)).rejects.toThrow("cancelled by the user")
    expect(await lstat(join(roots[0]!, "audio")).catch(() => undefined)).toBeUndefined()
  })
})
