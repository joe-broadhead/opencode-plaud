import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill } from "@opencode/plugin"
import type { PluginContext, Registration } from "./context.js"

/**
 * The hand-written skills in the package's `skills/` folder: one folder per
 * skill, each with a SKILL.md whose frontmatter `name` equals the folder name
 * and whose `description` is one line.
 */

const invalid = (what: string) => new Error(`SKILLS_INVALID: An opencode-plaud skill is broken: ${what}. Next step: Reinstall the plugin.`)

/** Parses the frontmatter; the body after it is the skill's content. CRLF files are accepted. */
export function parseSkill(folder: string, path: string, text: string): Skill.Info {
  const where = `skills/${folder}/SKILL.md`
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw invalid(`${where} has no frontmatter`)
  const fields = new Map(
    match[1]!.split("\n").flatMap((line) => {
      const colon = line.indexOf(":")
      return colon === -1 ? [] : [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as const]
    }),
  )
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

/** Reads the skills, then adds them in a synchronous transform. */
export async function registerSkills(ctx: { readonly skill: Pick<PluginContext["skill"], "transform"> }, directory: URL): Promise<Registration> {
  const skills = await loadSkills(directory)
  return ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill)
  })
}
