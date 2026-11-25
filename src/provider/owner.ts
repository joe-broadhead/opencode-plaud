/** Plaud's `get_current_user`: whose an account is, by the scheme the manifest declares (`plaud`). */
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { isRecord, nonEmpty } from "./client.js"

/** At most the contract's owner label length. */
const LABEL_MAX = 200

/**
 * The signed-in account from `get_current_user`: `plaud:` and its user id (or its email when Plaud gives no id), and
 * the nickname, name or email as the label. Undefined when Plaud names neither an id nor an email.
 */
export function ownerOf(payload: unknown): Owner | undefined {
  const user = isRecord(payload) && isRecord(payload["data"]) ? payload["data"] : payload
  if (!isRecord(user)) return undefined
  const email = nonEmpty(user["email"])?.toLowerCase()
  const id = nonEmpty(user["id"]) ?? nonEmpty(user["user_id"]) ?? (/^[^\s@]+@[^\s@]+$/.test(email ?? "") ? email : undefined)
  if (id === undefined) return undefined
  const label = nonEmpty(user["nickname"]) ?? nonEmpty(user["name"]) ?? email ?? id
  return { id: `plaud:${id.trim()}`, label: label.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX) || id }
}
