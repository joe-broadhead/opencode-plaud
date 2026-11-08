// Item 16: every string the model reads must be true under the default, where every tool runs without asking. A
// sentence may say a tool asks or is off only when it names the value that makes it so (`access`, "ask-changes" or
// "read-only"), so a reader can tell the claim depends on the configuration.
import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NAMESPACE } from "../src/host/tools/index.js"
import { exportTool } from "../src/host/tools/export.js"
import { recentTool } from "../src/host/tools/recent.js"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8")

const host = { tool: { list: async () => [] }, permission: { assert: async () => undefined } } as never
const settings = { exportRoots: ["/tmp/plaud"], maxAudioBytes: 1_000_000, exportTimeoutMs: 1_000 }

/** Every sentence the model is given: the namespace, the plugin's own tool descriptions, the skills, the Jelly line. */
export function modelTexts(): [string, string][] {
  const jelly = JSON.parse(read("package.json")) as { jelly: { summary: string } }
  return [
    ["src/host/tools/index.ts (namespace)", NAMESPACE.description],
    ["src/host/tools/export.ts (plaud_export)", exportTool(host, settings, ["default"]).description],
    ["src/host/tools/recent.ts (plaud_recent)", recentTool(host, ["default"]).description],
    ["package.json (jelly summary)", jelly.jelly.summary],
    ...readdirSync(`${ROOT}skills`).map((name): [string, string] => [`skills/${name}/SKILL.md`, read(`skills/${name}/SKILL.md`)]),
  ]
}

/** A claim that a tool asks, waits for approval, or is off. */
const CLAIM = /(?:(?:a|each|every|any|the) (?:tool|tools|change|changes|export|exports|pin|pins|write|writes|delete|deletes|merge|merges|call|calls) (?:asks?|ask) (?:the user|first|you|before|each time|every time|for (?:each|every))|(?:tools|changes|exports|writes|pins|deletes|merges) (?:ask|asks) (?:the user|first|you|before|each time|every time|for (?:each|every))|it asks? (?:the user|first)|asks? (?:the user )?(?:before|each time|every time|for (?:each|every))|may ask|(?:is|are) off|(?:the user|you) approv)/iu
/** The value that makes such a claim true. */
const VALUE = /\baccess\b|\bask-changes\b|\bread-only\b/u

describe("the text the model is given", () => {
  test("says a tool asks or is off only in a sentence that names the value", () => {
    for (const [file, text] of modelTexts()) {
      for (const sentence of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(Boolean)) {
        if (!CLAIM.test(sentence)) continue
        expect({ file, sentence, namesValue: VALUE.test(sentence) }).toEqual({ file, sentence, namesValue: true })
      }
    }
  })

  test("says the default allows every tool", () => {
    expect(NAMESPACE.description).toContain("Every tool is allowed by default")
  })
})
