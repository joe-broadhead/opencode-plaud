import { execFile } from "node:child_process"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const SCRIPT = fileURLToPath(new URL("../scripts/check-upstream.mjs", import.meta.url))
const tool = (name: string, required: string[] = []) => ({ name, inputSchema: { type: "object", required } })

let server: Server | undefined
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

/** A Streamable HTTP MCP fake: JSON or SSE responses, a session id, and two pages of tools. */
async function fakeServer(tools: object[], sse = false): Promise<string> {
  server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      if (request.headers.authorization !== "Bearer test-token") return void response.writeHead(401).end()
      const message = JSON.parse(body) as { id?: number; method: string; params?: { cursor?: string } }
      if (message.id === undefined) return void response.writeHead(202).end()
      if (message.method !== "initialize" && request.headers["mcp-session-id"] !== "s1") return void response.writeHead(400).end()
      const half = Math.ceil(tools.length / 2)
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake-plaud", version: "9.9.9" } }
          : message.params?.cursor === "2"
            ? { tools: tools.slice(half) }
            : { tools: tools.slice(0, half), nextCursor: "2" }
      const payload = JSON.stringify({ jsonrpc: "2.0", id: message.id, result })
      response.writeHead(200, { "content-type": sse ? "text/event-stream" : "application/json", "mcp-session-id": "s1" })
      response.end(sse ? `event: message\ndata: ${payload}\n\n` : payload)
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`
}

function run(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--disable-warning=ExperimentalWarning", SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", ...env } }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    )
  })
}

const KNOWN = [tool("list_files"), tool("get_file", ["file_id"]), tool("get_note", ["file_id"]), tool("get_transcript", ["file_id"]), tool("get_current_user")]

describe("check:upstream", () => {
  it("reports no drift when the live tools are the known reads", async () => {
    const url = await fakeServer(KNOWN)
    const result = await run(["--url", url], { PLAUD_MCP_TOKEN: "test-token" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("fake-plaud 9.9.9")
    expect(result.stdout).toContain("get_file(file_id)")
    expect(result.stdout).toContain("no drift")
  })

  it("warns, without failing, about new and missing tools over SSE", async () => {
    const url = await fakeServer([...KNOWN.filter((entry) => entry.name !== "get_note"), tool("delete_file")], true)
    const result = await run(["--url", url], { PLAUD_MCP_TOKEN: "test-token" })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('known read "get_note" is gone')
    expect(result.stderr).toContain('"delete_file" is not a known read, so it asks')
    expect(result.stdout).not.toContain("no drift")
  })

  it("exits 2 when it cannot check", async () => {
    expect((await run([], {})).code).toBe(2)
    const url = await fakeServer(KNOWN)
    const denied = await run(["--url", url], { PLAUD_MCP_TOKEN: "wrong" })
    expect(denied.code).toBe(2)
    expect(denied.stderr).toContain("HTTP 401")
  })
})
