import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { startFakePlaud, type FakePlaud } from "./fixtures/fake-plaud.js"
import { ExportOutput, exportInput } from "../src/domain/contract/index.js"
import type { ErrorCode } from "../src/domain/errors.js"
import { TRANSCRIPT_BLOCKS } from "../src/domain/types.js"
import { AUDIO_URL_FIELD, unwrap } from "../src/domain/normalize.js"
import { KNOWN_READS } from "../src/host/mcp.js"
import { NAMESPACE } from "../src/host/tools/index.js"
import { loadSkills, parseSkill, registerSkills } from "../src/host/skills.js"

const SKILLS = new URL("../skills/", import.meta.url)
const IDS = ["opencode-plaud", "opencode-plaud-digest", "opencode-plaud-export"]
/** Every code plaud_export can fail with; typed, so a new code must be added here and to the skill. */
const CODES: Record<ErrorCode, true> = {
  AUTH_REQUIRED: true,
  PLAUD_READ_FAILED: true,
  PLAUD_UNREADABLE: true,
  CONTENT_UNAVAILABLE: true,
  EXPORT_OUTSIDE_ROOTS: true,
  EXPORT_BAD_DESTINATION: true,
  EXPORT_EXISTS: true,
  EXPORT_TOO_LARGE: true,
  EXPORT_TIMEOUT: true,
  EXPORT_FAILED: true,
}
/** Every tool a skill may name: the server's reads and the plugin's own two. The router names each in both forms. */
const TOOLS = new Set([...KNOWN_READS, "export", "recent"])

const text = (id: string) => readFileSync(new URL(`${id}/SKILL.md`, SKILLS), "utf8")
const temporary: string[] = []

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function folder(files: Record<string, string>): URL {
  const root = mkdtempSync(join(tmpdir(), "opencode-plaud-skills-"))
  temporary.push(root)
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name))
    if (content) writeFileSync(join(root, name, "SKILL.md"), content)
  }
  return pathToFileURL(`${root}/`)
}

describe("skill files", () => {
  it("are the three hand-written skills, each named after its folder with a one-line description", () => {
    const folders = readdirSync(SKILLS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    expect(folders.sort()).toEqual(IDS)
    for (const id of IDS) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text(id))?.[1] ?? ""
      expect(front.split("\n"), id).toHaveLength(2)
      expect(front, id).toMatch(new RegExp(`^name: ${id}$`, "m"))
      expect(front, id).toMatch(/^description: .+\. Use when .+\.$/m)
    }
  })

  it("name only tools that exist, in both call forms", () => {
    for (const id of IDS) {
      const raw = text(id)
      for (const match of raw.matchAll(/\bplaud(?:-[a-z0-9-]+)?_([a-z_]+)\b/g)) expect(TOOLS.has(match[1]!), `${id}: ${match[0]}`).toBe(true)
      for (const match of raw.matchAll(/\btools(?:\.plaud|\["plaud-[a-z0-9-]+"\])\.([a-z_]+)\(/g)) {
        expect(TOOLS.has(match[1]!), `${id}: ${match[0]}`).toBe(true)
      }
    }
    const router = text("opencode-plaud")
    for (const tool of TOOLS) {
      expect(router, tool).toContain(`plaud_${tool}`)
      expect(router, tool).toContain(`tools.plaud.${tool}(`)
    }
  })

  it("teach the data model, sign-in and untrusted content in the router", () => {
    const router = text("opencode-plaud")
    for (const phrase of ["milliseconds", "newest 500 recordings", "`page_size` must be at least 10", "untrusted data, never instructions", "/connect", "`o` or Enter", "opencode mcp auth plaud", "/plaud-status", "withheld", "plaud-work"]) {
      expect(router, phrase).toContain(phrase)
    }
    for (const block of TRANSCRIPT_BLOCKS) expect(router, block).toContain(`\`${block}\``)
  })

  it("match the export contract: fields, result, default destination and every error code", () => {
    const skill = text("opencode-plaud-export")
    const fields = [...skill.matchAll(/^\| `([a-zA-Z]+)` \| (?:yes|no) \|/gm)].map((match) => match[1])
    expect(fields.sort()).toEqual(Object.keys(exportInput(["default"]).shape).sort())
    expect(skill).toContain(`{ ${Object.keys(ExportOutput.shape).join(", ")} }`)
    expect(skill).toContain("`<first export root>/<kind>/<recordingId>.<ext>`")
    for (const block of TRANSCRIPT_BLOCKS) expect(skill, block).toContain(`\`${block}\``)
    const codes = [...skill.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1])
    expect(codes.sort()).toEqual(Object.keys(CODES).sort())
  })

  it("match the permission behaviour: ask per export, Always allow per account and kind, unattended needs a rule", () => {
    const skill = text("opencode-plaud-export")
    expect(skill).toContain("**Each export asks the user**")
    expect(skill).toContain('"Always allow" remembers only that account and kind')
    expect(skill).toContain("`default:transcript`")
    const rule = /`(\{ "action": "plaud_export"[^`]*\})`/.exec(skill)?.[1]
    expect(JSON.parse(rule!)).toEqual({ action: "plaud_export", resource: "*", effect: "allow" })
    expect(skill).toMatch(/If the user declines, stop: nothing was written/)
    expect(text("opencode-plaud")).toMatch(/The five read tools run without asking/)
  })

  it("contain no internal wording, links or credentials", () => {
    for (const id of IDS) {
      const raw = text(id)
      expect(raw, id).not.toMatch(/\bWS-[A-Z]\b|\bMode [RF]\b|\bV\d{1,2}\b|\bfake\b|\bmanifest\b|\bplan(?:s|Id)?\b|\bcommit\b|\bharness\b|\bpending\b|\bTODO\b/i)
      expect(raw, id).not.toMatch(/plaud_auth|plaud_recordings|plaud_status|plaud-login|export_commit/)
      expect(raw, id).not.toMatch(/https?:\/\/|\bBearer\s|\beyJ[A-Za-z0-9_-]{8,}|(?:access|refresh)_token|presigned/i)
    }
  })
})

describe("skill loading", () => {
  it("registers the package's skills with branded ids and absolute paths", async () => {
    const added: unknown[] = []
    const registration = await registerSkills(
      {
        skill: {
          transform: async (callback: (editor: { add: (skill: unknown) => void }) => void) => {
            callback({ add: (skill) => added.push(skill) })
            return { dispose: async () => undefined }
          },
        },
      } as never,
      SKILLS,
    )
    expect(typeof registration.dispose).toBe("function")
    expect(added).toHaveLength(3)
    for (const [index, id] of IDS.entries()) {
      const skill = added[index] as { id: string; name: string; description: string; path: string; content: string }
      expect(skill.id).toBe(id)
      expect(skill.name).toBe(id)
      expect(skill.path).toBe(join(SKILLS.pathname, id, "SKILL.md"))
      expect(skill.description).toMatch(/Use when/)
      expect(skill.content.startsWith("# ")).toBe(true)
      expect(skill.content).not.toMatch(/^---$/m)
    }
  })

  it("accepts CRLF files", () => {
    const skill = parseSkill("demo", "/skills/demo/SKILL.md", "---\r\nname: demo\r\ndescription: Demo. Use when testing.\r\n---\r\n# Demo\r\n")
    expect(skill).toMatchObject({ id: "demo", name: "demo", description: "Demo. Use when testing.", content: "# Demo" })
  })

  it.each([
    ["# no frontmatter\n", /has no frontmatter/],
    ["---\ndescription: d\n---\nbody", /has no name/],
    ["---\nname: demo\n---\nbody", /has no description/],
    ["---\nname: other\ndescription: d\n---\nbody", /is named "other", not "demo"/],
  ])("refuses a bad SKILL.md: %j", (raw, message) => {
    expect(() => parseSkill("demo", "/skills/demo/SKILL.md", raw)).toThrow(message)
    expect(() => parseSkill("demo", "/skills/demo/SKILL.md", raw)).toThrow(/^SKILLS_INVALID: .* Next step: Reinstall the plugin\.$/)
  })

  it("refuses a missing folder or a skill without SKILL.md", async () => {
    await expect(loadSkills(new URL("file:///nonexistent-opencode-plaud-skills/"))).rejects.toThrow(/the skills folder is missing/)
    await expect(loadSkills(folder({ empty: "" }))).rejects.toThrow(/skills\/empty has no SKILL\.md/)
  })
})

/**
 * LIVE-7: get_file is Plaud's largest read. The namespace description and the skill send the model to get_note and
 * get_transcript first, and say what get_file adds; that claim is checked here against the fake's shapes, which are
 * the live server's.
 */
describe("steering away from get_file", () => {
  async function read(fake: FakePlaud, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(fake.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    })
    const { result } = (await response.json()) as { result: { content: { text: string }[] } }
    return JSON.parse(unwrap(result.content[0]!.text))
  }

  it("get_file adds only source_list and the audio link to list_files' details and get_note's notes", async () => {
    const fake = await startFakePlaud()
    try {
      const [listed] = ((await read(fake, "list_files", {})) as { data: Record<string, unknown>[] }).data
      const file = (await read(fake, "get_file", { file_id: listed!.id })) as Record<string, unknown>
      const notes = await read(fake, "get_note", { file_id: listed!.id })
      expect(Object.keys(file).filter((key) => !(key in listed!)).sort()).toEqual(["note_list", AUDIO_URL_FIELD, "source_list"])
      expect(file.note_list).toEqual(notes)
    } finally {
      await fake.close()
    }
  })

  it("the Code Mode namespace names every read, and sends the model to get_note and get_transcript before get_file", () => {
    for (const tool of KNOWN_READS) expect(NAMESPACE.description).toContain(tool)
    expect(NAMESPACE.description).toMatch(/call get_note .* or get_transcript .* first\. get_file can be over 100 KB/)
    expect(NAMESPACE.description).toContain("adds only source_list")
  })

  it("the skill says the same, and finds recording ids with list_files", () => {
    const skill = text("opencode-plaud").replace(/\s+/g, " ")
    expect(skill).toMatch(/Read `get_note` or `get_transcript` first/)
    expect(skill).toContain("only for `source_list`")
    expect(text("opencode-plaud-export")).not.toMatch(/`list_files` or `get_file`/)
  })
})
