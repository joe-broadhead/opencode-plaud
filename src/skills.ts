/**
 * The plugin's skills: one folder per skill under the package's `skills/`, each with a `SKILL.md` whose frontmatter
 * names it and describes it. `register` wires methods and doors, not skills, so setup adds them through
 * `ctx.skill.transform`, exactly where OpenCode loads a plugin's own skills.
 *
 * The frontmatter reader is a small YAML subset: top-level `key: value` pairs, with a `|` literal or `>` folded block
 * scalar for a value written on the following indented lines. A folded description is one line of text, so the parser
 * folds it exactly as YAML does, including the `-`/`+` chomping modifiers and the block's common indentation.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

const invalid = (what: string) => new Error(`SKILLS_INVALID: A plaud skill is broken: ${what}. Next step: Reinstall the plugin.`)

type Chomp = "clip" | "strip" | "keep"

interface BlockHeader {
  readonly style: "|" | ">"
  readonly chomp: Chomp
  /** The explicit indentation indicator, when the header names one. */
  readonly indent?: number
}

/** `|`, `>`, and the `-`/`+` and 1–9 indentation indicators, in either order (`>-2`, `|2-`). */
function blockHeader(value: string): BlockHeader | undefined {
  const named = /^([|>])([1-9]?)([+-]?)$/.exec(value) ?? /^([|>])([+-]?)([1-9]?)$/.exec(value)
  if (named === null) return undefined
  const indent = [named[2], named[3]].find((part): part is string => part !== undefined && /^[1-9]$/.test(part))
  return {
    style: named[1] as "|" | ">",
    chomp: value.includes("-") ? "strip" : value.includes("+") ? "keep" : "clip",
    ...(indent === undefined ? {} : { indent: Number(indent) }),
  }
}

/** One block scalar's content, folded or literal, with YAML's chomping applied. */
function blockScalar(header: BlockHeader, raw: readonly string[], terminated: boolean): string {
  const indents = raw.filter((line) => line.trim() !== "").map((line) => /^ */.exec(line)![0].length)
  const indent = header.indent ?? (indents.length === 0 ? 0 : Math.min(...indents))
  const lines = raw.map((line) => (line.trim() === "" ? "" : line.slice(Math.min(indent, line.length))))
  // YAML drops the block's trailing empty lines; the chomping decides which final breaks stay.
  let end = lines.length
  while (end > 0 && lines[end - 1] === "") end--
  const kept = lines.slice(0, end)
  const trailing = lines.length - end
  // A scalar always ends with one break; `keep` holds the source's extra trailing breaks too.
  const breaks = kept.length === 0 ? trailing : 1 + (terminated ? trailing : Math.max(0, trailing - 1))
  const endOf = (body: string): string => (header.chomp === "strip" ? body : header.chomp === "keep" ? `${body}${"\n".repeat(breaks)}` : `${body}\n`)

  if (header.style === "|") {
    const body = kept.join("\n")
    return body === "" ? (header.chomp === "keep" ? "\n".repeat(breaks) : "") : endOf(body)
  }
  // Folded: a line break between two text lines is a space; each blank line is a newline.
  let body = ""
  let blanks = 0
  let started = false
  for (const line of kept) {
    if (line === "") {
      blanks++
      continue
    }
    if (!started) {
      body += `${"\n".repeat(blanks)}${line}`
      started = true
    } else {
      body += `${blanks === 0 ? " " : "\n".repeat(blanks)}${line}`
    }
    blanks = 0
  }
  return body === "" ? (header.chomp === "keep" ? "\n".repeat(breaks) : "") : endOf(body)
}

/** The frontmatter's top-level fields, with a block scalar read from the lines that follow its header. */
function fieldsOf(frontmatter: string): Map<string, string> {
  const fields = new Map<string, string>()
  const lines = frontmatter.split("\n")
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (line.trim() === "" || /^\s/.test(line) || line.trimStart().startsWith("#")) continue
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    const header = blockHeader(rest)
    if (header === undefined) {
      fields.set(key, rest)
      continue
    }
    const block: string[] = []
    let next = at + 1
    for (; next < lines.length; next++) {
      const candidate = lines[next]!
      if (candidate.trim() !== "" && !/^\s/.test(candidate)) break
      block.push(candidate)
    }
    // A block cut by a following line had a break after its last line; one that ends the frontmatter did not.
    fields.set(key, blockScalar(header, block, next < lines.length))
    at = next - 1
  }
  return fields
}

/** Parses the frontmatter; the body after it is the skill's content. CRLF files are accepted. */
export function parseSkill(folder: string, path: string, text: string): Skill.Info {
  const where = `skills/${folder}/SKILL.md`
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw invalid(`${where} has no frontmatter`)
  const fields = fieldsOf(match[1]!)
  const name = fields.get("name")
  const description = fields.get("description")
  if (!name) throw invalid(`${where} has no name`)
  if (!description) throw invalid(`${where} has no description`)
  if (name !== folder) throw invalid(`${where} is named "${name}", not "${folder}"`)
  return {
    id: Skill.ID.make(name),
    name: Skill.Name.make(name),
    description,
    path: Skill.Info.fields.path.make(path),
    content: match[2]!.trim(),
  }
}

/** Reads every skill under `directory`, in folder-name order. */
export async function loadSkills(directory: URL): Promise<Skill.Info[]> {
  const root = fileURLToPath(directory)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => {
    throw invalid("the skills folder is missing")
  })
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  return Promise.all(
    folders.map(async (folder) => {
      const path = join(root, folder, "SKILL.md")
      const text = await readFile(path, "utf8").catch(() => {
        throw invalid(`skills/${folder} has no SKILL.md`)
      })
      return parseSkill(folder, path, text)
    }),
  )
}

/** Adds the skills read by `loadSkills` in a synchronous transform, beside the plugin's one `register` call. */
export async function registerSkills(ctx: Pick<Plugin.Context, "skill">, skills: readonly Skill.Info[]): Promise<Awaited<ReturnType<Plugin.Context["skill"]["transform"]>>> {
  return ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill)
  })
}
