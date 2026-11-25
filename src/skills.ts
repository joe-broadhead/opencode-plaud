/**
 * The plugin's skills: one folder per skill under the package's `skills/`, each with a `SKILL.md` whose frontmatter
 * names it and describes it. `register` wires methods and doors, not skills, so setup adds them through
 * `ctx.skill.transform`, exactly where OpenCode loads a plugin's own skills.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

const invalid = (what: string) => new Error(`SKILLS_INVALID: A plaud skill is broken: ${what}. Next step: Reinstall the plugin.`)

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

/** Adds the skills read by `loadSkills` in a synchronous transform, beside the plugin's one `register` call. */
export async function registerSkills(ctx: Pick<Plugin.Context, "skill">, skills: readonly Skill.Info[]): Promise<Awaited<ReturnType<Plugin.Context["skill"]["transform"]>>> {
  return ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill)
  })
}
