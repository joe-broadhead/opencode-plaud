#!/usr/bin/env node
/**
 * Maintainer check: compare the Plaud MCP server's live tool list with the
 * tools this plugin treats as known reads. It only warns. A new upstream
 * tool already asks by default; a missing known read needs a plugin change.
 *
 *   PLAUD_MCP_TOKEN=<OAuth access token> npm run check:upstream [-- --url <server URL>]
 *
 * The token is an access token for the server, such as the one OpenCode
 * stores after `opencode mcp auth plaud`. The default URL and the known-tool
 * list come from the TypeScript source, bundled in memory with esbuild.
 *
 * Exit codes: 0 checked (warnings or not), 2 could not check.
 */
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const source = await build({
  stdin: {
    contents: 'export { DEFAULT_URL } from "./src/domain/config.ts"\nexport { KNOWN_READS } from "./src/host/mcp.ts"',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
})
const { DEFAULT_URL, KNOWN_READS } = await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString("base64")}`)

const { values } = parseArgs({ options: { url: { type: "string", default: DEFAULT_URL } } })
const token = process.env.PLAUD_MCP_TOKEN
if (!token) {
  console.error("check:upstream: set PLAUD_MCP_TOKEN to an access token for the Plaud MCP server.")
  process.exit(2)
}

let session
let id = 0
async function rpc(method, params, notification = false) {
  const response = await fetch(values.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, ...(notification ? {} : { id: ++id }), ...(params ? { params } : {}) }),
  })
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${response.statusText}`)
  session = response.headers.get("mcp-session-id") ?? session
  if (notification) return undefined
  const text = await response.text()
  const bodies = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [text]
  const message = bodies.map((body) => JSON.parse(body)).find((entry) => entry.id === id)
  if (!message) throw new Error(`${method}: no response`)
  if (message.error) throw new Error(`${method}: ${message.error.message ?? JSON.stringify(message.error)}`)
  return message.result
}

let tools = []
try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "opencode-plaud-check-upstream", version: "0" },
  })
  await rpc("notifications/initialized", undefined, true)
  let cursor
  do {
    const page = await rpc("tools/list", cursor ? { cursor } : {})
    tools = tools.concat(page.tools ?? [])
    cursor = page.nextCursor
  } while (cursor)
  console.log(`check:upstream: ${init.serverInfo?.name ?? "server"} ${init.serverInfo?.version ?? ""} at ${values.url}: ${tools.length} tools`)
} catch (error) {
  console.error(`check:upstream: could not read the tool list: ${error instanceof Error ? error.message : error}`)
  process.exit(2)
}

const live = new Map(tools.map((tool) => [tool.name, tool]))
const warnings = [
  ...KNOWN_READS.filter((name) => !live.has(name)).map((name) => `known read "${name}" is gone; plaud*_${name} no longer exists`),
  ...[...live.keys()].filter((name) => !KNOWN_READS.includes(name)).map((name) => `"${name}" is not a known read, so it asks; add it to KNOWN_READS only if it is a harmless read`),
]
for (const name of KNOWN_READS.filter((name) => live.has(name))) {
  const required = live.get(name).inputSchema?.required ?? []
  console.log(`  ${name}(${required.join(", ")})`)
}
for (const warning of warnings) console.warn(`  warning: ${warning}`)
if (warnings.length === 0) console.log("check:upstream: no drift")
