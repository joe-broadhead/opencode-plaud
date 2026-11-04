export const PLUGIN_ID = "plaud.recordings"

// The build and the tests' config replace __PLUGIN_VERSION__ with package.json's version, so no source repeats it.
declare const __PLUGIN_VERSION__: string

/** The plugin's own version. */
export const PLUGIN_VERSION: string = __PLUGIN_VERSION__

/** The OpenCode releases this plugin supports. `package.json` `opencode.host` states the same range. */
export const SUPPORTED_HOSTS = ">=2.2.3 <2.3.0"

/** The releases every host, pack and stock check runs on: the one list the tests and CI read. */
export const TESTED_HOSTS: readonly string[] = ["2.2.3", "2.2.4", "2.2.5"]

/**
 * The host check: `range` is the supported range, `tested` is true only for a release in `TESTED_HOSTS`, and
 * `inRange` says whether the release is inside the range. Outside it, the plugin loads only with `allowUntestedHost`.
 */
export interface HostCheck {
  readonly version: string
  readonly range: string
  readonly tested: boolean
  readonly inRange: boolean
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/
const RANGE = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/

function release(version: string): [number, number, number] | undefined {
  const match = RELEASE.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/** A plain release inside `SUPPORTED_HOSTS`. Prereleases, dev builds and "unknown" are outside it. */
export function isSupportedHost(version: string): boolean {
  const [, floor, ceiling] = RANGE.exec(SUPPORTED_HOSTS)!
  const host = release(version)
  return host !== undefined && compare(host, release(floor!)!) >= 0 && compare(host, release(ceiling!)!) < 0
}

/** One of the releases every check runs on. */
export function isTestedHost(version: string): boolean {
  return TESTED_HOSTS.includes(version)
}

/**
 * Refuses an OpenCode outside the supported range unless `allowUntestedHost` is set; then setup goes on and the
 * status views say so. A release inside the range that is not in `TESTED_HOSTS` starts, and status calls it untested.
 */
export function checkHost(version: string, allowUntestedHost: boolean): HostCheck {
  const check = { version, range: SUPPORTED_HOSTS, tested: isTestedHost(version), inRange: isSupportedHost(version) }
  if (check.inRange || allowUntestedHost) return check
  throw new Error(
    `HOST_UNTESTED: opencode-plaud supports OpenCode ${SUPPORTED_HOSTS}, and this is OpenCode ${version}. Next step: Install an OpenCode release in that range, or set the plugin option "allowUntestedHost": true to load it anyway.`,
  )
}

/** The warning setup prints for a release that is not tested, or undefined. */
export function hostWarning(host: HostCheck): string | undefined {
  if (host.tested) return undefined
  return host.inRange
    ? `opencode-plaud is tested on OpenCode ${TESTED_HOSTS.join(", ")}, and this is OpenCode ${host.version}: inside the supported range ${host.range}, but untested.`
    : `opencode-plaud supports OpenCode ${host.range}, and this is OpenCode ${host.version}. It was loaded because "allowUntestedHost" is set.`
}
