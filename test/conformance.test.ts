// The source contract's conformance kit over the source this plugin declares in package.json's `sources`
// (`plaud.recordings`), run on the plugin's own tools RPC methods `events_list` and `probe` against invented Plaud
// answers (test/fixtures/sources.json): no Plaud call, no sign-in. The reads go through a fake of OpenCode's executors
// that asserts `plaud_<tool>` on the kit's recording permission, as the host asserts an MCP tool, so the kit sees exactly
// what each read asserts. The report is written to reports/conformance-report.json, for a release to attach.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { declarationProblems, sourceConformance, type ConformanceReport, type PageCase, type SessionContext } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { evaluate, sessionRules } from "@we-the-rebel-alliance/source-contract/permission"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { eventsMethod, owners, PACKAGE, probeMethod, RECORDINGS, type Owners } from "../src/host/tools/events.js"
import { TOOLS_RPC_ID } from "../src/host/tools-rpc.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
const contract = JSON.parse(readFileSync(join(ROOT, "node_modules/@we-the-rebel-alliance/source-contract/package.json"), "utf8")) as { version: string }
/** The declaration as Memory's schema parses it, which is what the kit takes. */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value

interface Recording {
  readonly id: string
  readonly name: string
  readonly start_at: string
  readonly created_at: string
  readonly duration: number
}
const PLAUD = JSON.parse(readFileSync(join(ROOT, "test/fixtures/sources.json"), "utf8")) as { user: Record<string, unknown>; recordings: Recording[]; later: Recording[]; late: Recording[] }
/** Every recording, each held by Plaud from its `created_at` on. */
const HELD = [...PLAUD.recordings, ...PLAUD.later, ...PLAUD.late]

/** When the first listing is read, and when the kit's cases are: by then, two recordings reached Plaud late (`late`). */
const FIRST = Date.parse("2026-11-06T00:00:00Z")
const NOW = Date.parse("2026-11-09T12:00:00Z")
const SINCE = "2026-10-15T00:00:00Z"
const ACCOUNT = "default"
const ACCOUNTS: [string, ...string[]] = ["default", "work"]
const ATOMIC = "list_files answers whole pages of recordings, and a recording is never read on its own, so no single recording can fail on its own"
const tools = pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^plaud\./, ""), readOnly: tool.readOnly }))

const enveloped = (value: unknown) => ({
  content: [{ type: "text", text: `Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(value)}\n</untrusted-user-data-ab12>` }],
})

/**
 * OpenCode's executors of the default account's server, `plaud`, answering from the fixture: list_files filters whole
 * UTC days by start and lists newest first, as Plaud does, and holds a recording from its `created_at` on. Each asserts
 * its own tool id on the session's permission first, as the host does for an MCP tool.
 */
function executors(permission: () => SessionContext["permission"], clock: () => number) {
  const answer = (tool: string, args: Record<string, unknown>) => {
    if (tool === "get_current_user") return { content: [{ type: "text", text: JSON.stringify(PLAUD.user) }] }
    const from = String(args["date_from"])
    const to = String(args["date_to"])
    const page = Number(args["page"] ?? 1)
    const size = Number(args["page_size"])
    const days = HELD.filter((item) => Date.parse(`${item.created_at}Z`) <= clock())
      .filter((item) => item.start_at.slice(0, 10) >= from && item.start_at.slice(0, 10) <= to)
      .sort((a, b) => b.start_at.localeCompare(a.start_at))
    return enveloped({ type: "files", data: days.slice((page - 1) * size, page * size), page, page_size: size })
  }
  return ["get_current_user", "list_files"].map((tool) => ({
    id: `plaud_${tool}`,
    execute: async (args: Record<string, unknown>) => {
      await permission().assert({ action: `plaud_${tool}`, resources: ["*"] })
      return answer(tool, args)
    },
  }))
}

const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_conformance", id: "call_conformance", signal: new AbortController().signal, progress: async () => {} })

/** One plugin instance: its record of owners, and its methods over the executors, with whichever session is calling. */
function plugin(clock: () => number, kept: Owners = owners()) {
  let current: SessionContext["permission"] | undefined
  const permission = () => {
    if (current === undefined) throw new Error("an assert ran outside a kit call")
    return current
  }
  const host = {
    tool: { list: async () => executors(permission, clock) },
    permission: { assert: async (request: { action: string; resources: string[] }) => permission().assert({ action: request.action, resources: request.resources }) },
  } as never
  const events = eventsMethod(host, ACCOUNTS, kept, clock)
  const probe = probeMethod(host, ACCOUNTS, kept)
  const run = (method: typeof events, input: Readonly<Record<string, unknown>>, context: SessionContext) => {
    current = context.permission
    return method.run(input, call()).finally(() => (current = undefined))
  }
  return { list: (input: Readonly<Record<string, unknown>>, context: SessionContext) => run(events, input, context), probe: (input: Readonly<Record<string, unknown>>, context: SessionContext) => run(probe, input, context) }
}

const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
const reports: ConformanceReport[] = []

afterAll(() => {
  if (reports.length === 0) return
  const installed = readInstalledDescriptor(ROOT, { version: pkg.version })
  const report = {
    contract: `@we-the-rebel-alliance/source-contract@${contract.version}`,
    plugin: pkg.name,
    version: pkg.version,
    descriptorHash: installed.ok ? installed.value.hash : null,
    ok: reports.every((entry) => entry.ok),
    sources: reports,
  }
  mkdirSync(join(ROOT, "reports"), { recursive: true })
  writeFileSync(join(ROOT, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
})

describe("the source contract's conformance kit", () => {
  it("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(ROOT, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => [item.id, item.input?.["source"]])).toEqual([["plaud.recordings", RECORDINGS]])
  })

  it("plaud.recordings keeps the contract", async () => {
    let now = FIRST
    const { list, probe } = plugin(() => now)
    // A consumer binds the source with probe first: it names the owner, which every page then carries.
    await probe({ source: RECORDINGS, account: ACCOUNT }, open)
    const first = (await list({ source: RECORDINGS, account: ACCOUNT, since: SINCE }, open)) as { cursor: string; events: { external_id: string }[] }
    expect(first.events.map((event) => event.external_id)).toEqual(["rec-1999", "rec-2001", "rec-2002", "rec-2003", "rec-2005"])
    now = NOW
    let done = (await list({ source: RECORDINGS, account: ACCOUNT, cursor: first.cursor }, open)) as { cursor: string; more: boolean; events: { external_id: string }[]; gap?: unknown }
    // rec-2009 reached Plaud two days after it started, behind the cursor, and is listed; rec-2010 reached it 22 days
    // after, before the lookback, so the page answers an expired gap from its start.
    expect([done.events.map((event) => event.external_id), done.gap]).toEqual([["rec-2009", "rec-2006", "rec-2007", "rec-2008"], { reason: "expired", since: "2026-10-18T11:00:00.000Z" }])
    while (done.more) done = (await list({ source: RECORDINGS, account: ACCOUNT, cursor: done.cursor }, open)) as typeof done
    const cases: PageCase[] = [
      { name: "a first listing, one recording refused for a secret in its title", input: { source: RECORDINGS, account: ACCOUNT, since: SINCE }, expect: "page" },
      {
        name: "what came after the first listing: one recording that reached Plaud two days after it started, and an expired gap for one that reached it later than the lookback",
        input: { source: RECORDINGS, account: ACCOUNT, cursor: first.cursor },
        expect: "expired",
      },
      { name: "the same, two at a time, the gap on the first page only", input: { source: RECORDINGS, account: ACCOUNT, cursor: first.cursor, limit: 2 }, expect: "page" },
      { name: "nothing new since the last listing", input: { source: RECORDINGS, account: ACCOUNT, cursor: done.cursor }, expect: "empty" },
      { name: "a cursor without the account it reads", input: { source: RECORDINGS, cursor: first.cursor }, expect: { refuses: "INPUT_INVALID" } },
      { name: "a cursor passed for another account", input: { source: RECORDINGS, account: "work", cursor: first.cursor }, expect: { refuses: "ACCOUNT_MISMATCH" } },
      { name: "an account the plugin does not have", input: { source: RECORDINGS, account: "home", since: SINCE }, expect: { refuses: "ACCOUNT_MISMATCH" } },
      { name: "contract 1's cursor of the same account", input: { source: RECORDINGS, account: ACCOUNT, cursor: encodeCursor("plaud", { a: ACCOUNT, o: "0123456789abcdef", t: 0, i: "" }) }, expect: { refuses: "CURSOR_INVALID" } },
      {
        name: "a cursor bound to another plugin",
        input: { source: RECORDINGS, account: ACCOUNT, cursor: encodeBoundCursor({ plugin: "granola", source: RECORDINGS, account: ACCOUNT }, { a: ACCOUNT, o: "mailto:sam.rivera@example.com", l: "Sam Rivera", t: 0, i: "" }) },
        expect: { refuses: "CURSOR_INVALID" },
      },
      { name: "a source this plugin does not have", input: { source: "meetings", account: ACCOUNT }, expect: { refuses: "SOURCE_UNKNOWN" } },
    ]
    const report = await sourceConformance({
      plugin: PACKAGE,
      source: sources.items[0]!,
      tools,
      calls: { list, probe },
      cases,
      account: ACCOUNT,
      sources,
      describe: { id: TOOLS_RPC_ID },
      atomicPages: { reason: ATOMIC },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    // Every check runs, the expired gap's two included, except failed-holds-cursor, which cannot apply, with its reason.
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    expect(report.checks.filter((check) => check.ran).map((check) => check.name)).toEqual(expect.arrayContaining(["gap-and-cursor-expired", "gap-once-per-read"]))
    expect(report.checks.filter((check) => check.notApplicable && check.reason !== undefined).map((check) => [check.name, check.reason])).toEqual([["failed-holds-cursor", ATOMIC]])
  })

  it("a consumer's fenced session allows the server the account's reads actually call", () => {
    // accounts.server is plaud-{account}: the default account keeps plaud_<operation>, and a named account's grant
    // allows plaud-<alias>_<operation>, which is what reader() calls. The other server stays denied.
    const source = sources.items[0]!
    const fenced = (account: string) => {
      const rules = sessionRules(source as never, { source: source.id, account })
      if (!rules.ok) throw new Error(rules.problems.join("; "))
      return rules.value
    }
    expect(["plaud_events_list", "plaud_get_current_user", "plaud_list_files"].map((action) => evaluate(fenced("default"), action))).toEqual(["allow", "allow", "allow"])
    expect(["plaud_events_list", "plaud-work_get_current_user", "plaud-work_list_files"].map((action) => evaluate(fenced("work"), action))).toEqual(["allow", "allow", "allow"])
    expect(["plaud_list_files", "plaud-home_list_files"].map((action) => evaluate(fenced("work"), action))).toEqual(["deny", "deny"])
  })
})
