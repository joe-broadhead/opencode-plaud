/**
 * Every error the plugin reports carries a stable code, a human message and
 * a next step, rendered as `CODE: what happened. Next step: what to do.` so the model and the
 * user can act on it without reading code.
 */

/**
 * Every code the plugin reports, with what it means and the default next step: the README's table is generated from
 * this map and checked against it, so a code cannot ship without a row.
 */
export const ERRORS = {
  AUTH_REQUIRED: {
    meaning: "The account's Plaud server is not connected or not signed in.",
    next: "Run /connect and choose Plaud, or Plaud (<alias>) for another account, then press o or Enter to open the sign-in page.",
  },
  INPUT_INVALID: {
    meaning: "A call's input is not the method's schema, such as `account` in a plugin tool's input.",
    next: "Call describe for the schema, then pass the fields it names; the account is the envelope's.",
  },
  PLAUD_READ_FAILED: {
    meaning: "A read the plugin's own tool made failed, such as a list or a transcript page.",
    next: "Retry once; if it fails again, ask the user to run /plaud-status and follow its next step.",
  },
  PLAUD_UNREADABLE: {
    meaning: "Plaud returned something this release cannot use, such as a page that never ends or a link that is not a URL.",
    next: "Update opencode-plaud and retry later; if it still fails, report it to the plugin's maintainers.",
  },
  CONTENT_UNAVAILABLE: {
    meaning: "Plaud has no audio, or no such transcript block, for that recording.",
    next: "Export another transcript block, or the note.",
  },
  EXPORT_OUTSIDE_ROOTS: {
    meaning: "The destination is outside the export folders the plugin may write in.",
    next: "Write inside a root the plugin lists, or ask the user to add the folder to exportRoots.",
  },
  EXPORT_BAD_DESTINATION: {
    meaning: "The destination is not a file path the plugin can write.",
    next: "Pass a plain file path, without a trailing slash, and without `~`, which is not expanded.",
  },
  EXPORT_EXISTS: {
    meaning: "The destination file exists and overwrite was not set.",
    next: "Ask the user before passing overwrite: true, or choose another path.",
  },
  EXPORT_TOO_LARGE: {
    meaning: "The exported text is over the 25 MiB cap.",
    next: "Export one transcript block or the note instead of everything.",
  },
  EXPORT_TIMEOUT: {
    meaning: "The export did not finish inside exportTimeoutMs.",
    next: "Ask the user to raise exportTimeoutMs, then retry.",
  },
  EXPORT_FAILED: {
    meaning: "Writing the file failed.",
    next: "Check the folder is writable and there is space, then retry.",
  },
} as const satisfies Record<string, { readonly meaning: string; readonly next: string }>

export type ErrorCode = keyof typeof ERRORS

/** Every code the plugin reports, in table order. */
export const ERROR_CODES = Object.keys(ERRORS) as readonly ErrorCode[]

export class PlaudError extends Error {
  readonly code: ErrorCode
  readonly detail: string
  readonly nextStep: string

  constructor(code: ErrorCode, detail: string, nextStep: string) {
    super(`${code}: ${/[.!?]$/.test(detail) ? detail : `${detail}.`} Next step: ${nextStep}`)
    this.name = "PlaudError"
    this.code = code
    this.detail = detail
    this.nextStep = nextStep
  }
}

/** PLAUD_UNREADABLE's next step: Plaud returned something this release cannot use, so a newer one may. */
export const UNREADABLE_STEP = "Update opencode-plaud and retry later; if it still fails, report it to the plugin's maintainers."

export function fail(code: ErrorCode, detail: string, nextStep: string): never {
  throw new PlaudError(code, detail, nextStep)
}
