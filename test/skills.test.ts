/** The skill frontmatter reader, checked against a real YAML parser: folded and literal descriptions must match. */
import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { parseSkill } from "../src/skills.js"

const skill = (header: string, lines: readonly string[] = ["A description."]) =>
  `---\nname: demo\ndescription: ${header}\n${lines.map((line) => `  ${line}`).join("\n")}\n---\n\n# Demo\n`

const parsed = (text: string): string => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ""
  return (parseYaml(frontmatter) as { description: string }).description
}

const CASES: readonly { readonly name: string; readonly text: string }[] = [
  { name: "a folded block", text: skill(">", ["One line,", "then another."]) },
  { name: "a folded block with a blank line", text: skill(">", ["One paragraph.", "", "A second one."]) },
  { name: "a folded block with two blank lines", text: skill(">", ["One.", "", "", "Two."]) },
  { name: "a folded block with a strip modifier", text: skill(">-", ["One line,", "then another."]) },
  { name: "a folded block with a keep modifier", text: skill(">+", ["One line,", "then another.", ""]) },
  { name: "a literal block", text: skill("|", ["One line,", "then another."]) },
  { name: "a literal block with a strip modifier", text: skill("|-", ["One line,", "then another."]) },
  { name: "a literal block with a keep modifier", text: skill("|+", ["One line,", "then another.", ""]) },
  { name: "an explicit indentation indicator", text: skill(">2", ["One line,", "then another."]) },
  { name: "a one-line description", text: skill("A single line, as it is.", []) },
]

describe("parseSkill", () => {
  it.each(CASES)("reads $name as the YAML parser does", ({ text }) => {
    expect(parseSkill("demo", "/tmp/demo/SKILL.md", text).description).toBe(parsed(text))
  })

  it("does not read a block header as the description", () => {
    const text = skill(">", ["A folded description."])
    expect(parseSkill("demo", "/tmp/demo/SKILL.md", text).description).not.toBe(">")
  })

  it("keeps the body after the frontmatter, and refuses a name that is not the folder", () => {
    const text = skill(">", ["A folded description."])
    const info = parseSkill("demo", "/tmp/demo/SKILL.md", text)
    expect(info.content).toBe("# Demo")
    expect(() => parseSkill("other", "/tmp/other/SKILL.md", text)).toThrow(/^SKILLS_INVALID: .* is named "demo", not "other"/)
  })
})
