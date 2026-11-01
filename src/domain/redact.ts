import { AUDIO_URL_FIELD, DATA_LINK_FIELD, unwrap } from "./normalize.js"

/**
 * Plaud's results carry signed links: `presigned_url` to a recording's audio
 * in `get_file`, and `data_link` to each source and note item in `get_file`
 * and `get_note`. Anyone who has one can download what it points to until it
 * expires, so each is a credential. Every one is replaced before the result
 * reaches the model, its session history or the model provider. Exports read
 * the results themselves and never return a link.
 */

export const AUDIO_URL_NOTICE = "withheld: use plaud_export to download the audio"
export const DATA_LINK_NOTICE = "withheld: use plaud_export to save the transcript or note"

const NOTICES: Readonly<Record<string, string>> = { [AUDIO_URL_FIELD]: AUDIO_URL_NOTICE, [DATA_LINK_FIELD]: DATA_LINK_NOTICE }
const FIELDS = Object.keys(NOTICES)

/** Replace every signed-link field that holds a value, at any depth. Returns the same value when there is none. */
export function withholdSignedLinks(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(withholdSignedLinks)
    return items.some((item, index) => item !== value[index]) ? items : value
  }
  if (typeof value !== "object" || value === null) return value
  let changed = false
  const entries = Object.entries(value).map(([key, item]) => {
    const notice = NOTICES[key]
    const next = notice !== undefined && item !== null && item !== "" ? notice : withholdSignedLinks(item)
    if (next !== item) changed = true
    return [key, next] as const
  })
  return changed ? Object.fromEntries(entries) : value
}

/**
 * The same for result text. JSON text, bare or in Plaud's envelope, is
 * rewritten field by field; other text that names a field loses every URL,
 * because the link cannot be told apart from the rest.
 */
export function withholdSignedLinksInText(text: string): string {
  if (!FIELDS.some((field) => text.includes(field))) return text
  const inner = unwrap(text)
  try {
    const rewritten = JSON.stringify(withholdSignedLinks(JSON.parse(inner) as unknown))
    return inner === text ? rewritten : text.replace(inner, () => rewritten)
  } catch {
    return scrubUrls(text)
  }
}

export function scrubUrls(text: string): string {
  // A URL ends before trailing punctuation, so the sentence around it survives.
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)\]]/gi, "[url withheld]")
}
