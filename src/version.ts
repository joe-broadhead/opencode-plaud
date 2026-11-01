export const PLUGIN_ID = "plaud.recordings"

/** The OpenCode releases this plugin is tested on. `package.json` `opencode.host` states the same range. */
export const TESTED_HOST = ">=2.2.3 <2.3.0"

export type HostCheck =
  | { readonly version: string; readonly tested: true }
  | { readonly version: string; readonly tested: false; readonly warning: string }

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

/** A plain release inside `TESTED_HOST`. Prereleases, dev builds and "unknown" are untested. */
export function isTestedHost(version: string): boolean {
  const [, floor, ceiling] = RANGE.exec(TESTED_HOST)!
  const host = release(version)
  return host !== undefined && compare(host, release(floor!)!) >= 0 && compare(host, release(ceiling!)!) < 0
}

/**
 * Refuses an untested OpenCode unless `allowUntestedHost` is set, in which
 * case setup goes on and the status views carry the warning.
 */
export function checkHost(version: string, allowUntestedHost: boolean): HostCheck {
  if (isTestedHost(version)) return { version, tested: true }
  const untested = `opencode-plaud is tested on OpenCode ${TESTED_HOST}, and this is OpenCode ${version}.`
  if (!allowUntestedHost) {
    throw new Error(
      `HOST_UNTESTED: ${untested} Next step: Install a tested OpenCode release, or set the plugin option "allowUntestedHost": true to load it anyway.`,
    )
  }
  return { version, tested: false, warning: `${untested} It was loaded because "allowUntestedHost" is set.` }
}
