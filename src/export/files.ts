/**
 * The local write an export makes: one permission gate, then the bytes are staged in a private file beside the
 * destination, hashed and fsynced, and published with a hard link (a rename when overwriting). The destination is never
 * half-written, and a declined or failed export leaves nothing behind.
 */
import { createHash, randomBytes } from "node:crypto"
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"

/** The audio download's limits. */
const MAX_REDIRECTS = 5
const REDIRECTS = new Set([301, 302, 303, 307, 308])
/** Filesystems without hard links; publication then checks and renames. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])

/** A loopback host name: the URL points at this machine. Plain http is accepted only there. */
export function onThisMachine(url: URL): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
}

/** True when `path` is `root` or inside it, both normalised. */
export function underRoot(path: string, root: string): boolean {
  const target = resolve(path)
  const base = resolve(root)
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

/** The export root that holds `path`, or a refusal naming every root. */
export function containingRoot(path: string, roots: readonly string[]): string {
  const found = roots.find((root) => underRoot(path, root))
  if (found !== undefined) return found
  throw new SourceError({
    code: "PERMISSION_DENIED",
    what: `${path} is outside the export roots (${roots.join(", ")})`,
    next: "Choose a destination inside an export root, or add a folder to the exportRoots option.",
  })
}

/** The real path of a folder that may not exist yet: realpath the longest existing ancestor, then rejoin the rest. */
export async function realFolder(folder: string): Promise<string> {
  const rest: string[] = []
  for (let at = resolve(folder); ; at = dirname(at)) {
    try {
      return join(await realpath(at), ...rest.reverse())
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = dirname(at)
      if (parent === at) return resolve(folder)
      rest.push(basename(at))
    }
  }
}

export type Write = (chunk: Uint8Array) => Promise<void>

/**
 * The destination's real path inside an export root. Missing folders are created (0700) one level at a time below the
 * root's real path, so a symlink that leads out of the roots is refused before anything is created through it.
 */
export async function prepare(path: string, roots: readonly string[], overwrite: boolean): Promise<string> {
  const root = resolve(containingRoot(path, roots))
  if (resolve(path) === root) {
    throw new SourceError({ code: "INPUT_INVALID", what: `${path} is an export root, not a file`, next: "Pass a file path inside it." })
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const allowed = await Promise.all(roots.map((item) => realpath(item).catch(() => resolve(item))))
  let directory = await realpath(root)
  for (const part of relativeParts(root, dirname(path))) {
    const next = join(directory, part)
    await mkdir(next, { mode: 0o700 }).catch((error: unknown) => (errorCode(error) === "EEXIST" ? undefined : Promise.reject(error)))
    directory = await realpath(next)
    if (!allowed.some((item) => underRoot(directory, item))) outsideRoots(path, roots)
  }
  const target = join(directory, basename(path))
  const existing = await lstat(target).catch((error: unknown) => (errorCode(error) === "ENOENT" ? undefined : Promise.reject(error)))
  if (existing?.isDirectory()) throw new SourceError({ code: "INPUT_INVALID", what: `${target} is a folder`, next: "Pass a file path, or omit destination for the default file name." })
  if (existing !== undefined && !overwrite) alreadyExists(target)
  return target
}

function relativeParts(root: string, directory: string): string[] {
  const path = resolve(directory)
  if (path === root) return []
  const relative = path.slice(root.endsWith(sep) ? root.length : root.length + 1)
  return relative.split(sep).filter((part) => part !== "")
}

/** Writes, hashes and fsyncs a private staging file beside the destination, then publishes it. */
export async function publish(path: string, overwrite: boolean, produce: (write: Write) => Promise<void>): Promise<{ path: string; bytes: number; sha256: string }> {
  const staging = join(dirname(path), `.plaud-export-${randomBytes(8).toString("hex")}.partial`)
  const hash = createHash("sha256")
  const handle = await open(staging, "wx", 0o600)
  let bytes = 0
  try {
    try {
      await produce(async (chunk) => {
        hash.update(chunk)
        bytes += chunk.byteLength
        for (let offset = 0; offset < chunk.byteLength; ) offset += (await handle.write(chunk, offset)).bytesWritten
      })
      await handle.sync()
    } finally {
      await handle.close()
    }
    await place(staging, path, overwrite)
    return { path, bytes, sha256: hash.digest("hex") }
  } finally {
    await unlink(staging).catch(() => undefined)
  }
}

async function place(staging: string, path: string, overwrite: boolean): Promise<void> {
  if (overwrite) return rename(staging, path)
  try {
    await link(staging, path)
  } catch (error) {
    if (errorCode(error) === "EEXIST") alreadyExists(path)
    if (!NO_HARD_LINKS.has(errorCode(error) ?? "")) throw error
    // The content still lands atomically, but a file created here in between would be replaced.
    if (await lstat(path).then(() => true, () => false)) alreadyExists(path)
    await rename(staging, path)
  }
}

/**
 * Fetches the audio, following redirects by hand: each hop must be https (or loopback http) with no user info, and a
 * local address may not be reached through a link that was not local.
 */
export async function download(link: string, options: { readonly maxBytes: number; readonly signal: AbortSignal; readonly local: (url: URL) => boolean }): Promise<Response> {
  const start = parseLink(link)
  let url = start
  for (let redirects = 0; ; redirects++) {
    let response: Response
    try {
      response = await fetch(url.href, { signal: options.signal, redirect: "manual" })
    } catch (error) {
      if (options.signal.aborted) throw error
      throw new SourceError({ code: "UNAVAILABLE", what: "the audio download could not start", next: "Check the network connection, then retry." })
    }
    if (!REDIRECTS.has(response.status)) {
      const declared = contentLength(response)
      if (!response.ok || (declared !== undefined && declared > options.maxBytes)) {
        await response.body?.cancel().catch(() => undefined)
        if (response.ok) {
          throw new SourceError({
            code: "TOO_LARGE",
            what: `the audio is ${declared} bytes, over maxAudioBytes (${options.maxBytes})`,
            next: "Raise the maxAudioBytes plugin option, or export the transcript or note instead.",
          })
        }
        throw new SourceError({ code: "UNAVAILABLE", what: `Plaud's audio server refused the download (HTTP ${response.status})`, next: "Retry; each export fetches a fresh audio link." })
      }
      return response
    }
    await response.body?.cancel().catch(() => undefined)
    if (redirects === MAX_REDIRECTS) throw new SourceError({ code: "UNAVAILABLE", what: `Plaud's audio link redirected more than ${MAX_REDIRECTS} times`, next: "Retry later." })
    const location = response.headers.get("location")
    const next = location === null ? null : URL.parse(location, url.href)
    if (next === null || !safeHop(next, options.local) || (options.local(next) && !options.local(url))) {
      // The link and its target are credentials: the message names neither.
      throw new SourceError({ code: "UNAVAILABLE", what: "Plaud's audio link redirected to an address that is not a valid https URL", next: "Retry later." })
    }
    url = next
  }
}

/** The signed audio link as a URL. The link is a credential, so no error names it. */
export function parseLink(link: string, local: (url: URL) => boolean = onThisMachine): URL {
  const url = URL.parse(link)
  if (url === null || !safeHop(url, local)) {
    throw new SourceError({ code: "UNAVAILABLE", what: "Plaud returned an audio link that is not a valid https URL", next: "Retry later." })
  }
  return url
}

/** https, or plain http on this machine only, with no user name or password in it. */
function safeHop(url: URL, local: (url: URL) => boolean): boolean {
  return (url.protocol === "https:" || (url.protocol === "http:" && local(url))) && url.username === "" && url.password === ""
}

/** Streams the body into staging under the byte cap, telling the caller how far it got. */
export async function stream(response: Response, write: Write, maxBytes: number, signal: AbortSignal, report: (bytes: number, total?: number) => void): Promise<void> {
  const body = response.body?.getReader()
  if (body === undefined) throw new SourceError({ code: "UNAVAILABLE", what: "Plaud's audio server sent no data", next: "Retry the export." })
  const total = contentLength(response)
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await bounded(body.read(), signal)
      if (done) return
      bytes += value.byteLength
      if (bytes > maxBytes) {
        throw new SourceError({
          code: "TOO_LARGE",
          what: `the audio grew past maxAudioBytes (${maxBytes}) during the download`,
          next: "Raise the maxAudioBytes plugin option, or export the transcript or note instead.",
        })
      }
      await write(value)
      report(bytes, total)
    }
  } catch (error) {
    void body.cancel().catch(() => undefined)
    if (error instanceof SourceError || signal.aborted || isSystemError(error)) throw error
    throw new SourceError({ code: "UNAVAILABLE", what: "the audio download was interrupted", next: "Retry the export." })
  }
}

/** Settles with `work`, or rejects as soon as the signal aborts, even when `work` ignores the signal. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  let abort = (): void => undefined
  const stopped = new Promise<never>((_resolve, reject) => (abort = () => reject(signal.reason)))
  signal.addEventListener("abort", abort, { once: true })
  return Promise.race([work, stopped]).finally(() => signal.removeEventListener("abort", abort))
}

function contentLength(response: Response): number | undefined {
  const length = Number(response.headers.get("content-length") ?? Number.NaN)
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined
}

function errorCode(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === "string" ? code : undefined
}

/** A filesystem failure: an error with an errno code and the failing syscall. */
function isSystemError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && errorCode(error) !== undefined && typeof (error as { syscall?: unknown }).syscall === "string"
}

function outsideRoots(path: string, roots: readonly string[]): never {
  throw new SourceError({
    code: "PERMISSION_DENIED",
    what: `${path} is outside the export roots (${roots.join(", ")})`,
    next: "Choose a destination inside an export root, or add a folder to the exportRoots plugin option.",
  })
}

function alreadyExists(path: string): never {
  throw new SourceError({
    code: "INPUT_INVALID",
    what: `a file already exists at ${path}`,
    next: "Ask the person whether to replace it; if they agree, plan again with overwrite: true, or choose another destination.",
  })
}
