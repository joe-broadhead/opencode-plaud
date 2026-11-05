/**
 * Every error the plugin reports carries a stable code, a human message and
 * a next step, rendered as `CODE: what happened. Next step: what to do.` so the model and the
 * user can act on it without reading code.
 */

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "INPUT_INVALID"
  | "PLAUD_READ_FAILED"
  | "PLAUD_UNREADABLE"
  | "CONTENT_UNAVAILABLE"
  | "EXPORT_OUTSIDE_ROOTS"
  | "EXPORT_BAD_DESTINATION"
  | "EXPORT_EXISTS"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_TIMEOUT"
  | "EXPORT_FAILED"

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
