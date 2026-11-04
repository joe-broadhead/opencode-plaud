import { mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll } from "vitest"
import { scratchDir } from "../scratch.js"
import { installNetworkGuard } from "./network.js"

// Runs before a test file imports the SDK, which reads its global paths once,
// at import: OPENCODE_TEST_HOME (or the OS home), the XDG variables and the
// temp directory. All of them point into a fresh root, and every inherited
// variable is removed, not just the OPENCODE ones, so no provider key, proxy
// or credential path leaks in. The root is under /tmp, with no OpenCode
// config above it for the host's upward search to find.
const sdkDir = process.env.HOST_SDK_DIR
export const WORKER_ROOT = scratchDir("plugin-host-worker-")
const root = WORKER_ROOT
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: join(root, "home"),
  OPENCODE_TEST_HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"),
  TMPDIR: join(root, "tmp"),
  TMP: join(root, "tmp"),
  TEMP: join(root, "tmp"),
  LANG: "en_US.UTF-8",
  TZ: "UTC",
  NODE_ENV: "test",
  ...(sdkDir ? { HOST_SDK_DIR: sdkDir } : {}),
})
for (const name of ["home", "config", "data", "state", "cache", "tmp"]) mkdirSync(join(root, name))
// The host also opens a location at the working directory; keep it out of the repository.
process.chdir(join(root, "home"))
export const network = installNetworkGuard()
afterAll(() => {
  network.restore()
  rmSync(root, { recursive: true, force: true })
})
