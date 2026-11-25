/**
 * Rebuilds `fixtures/conformance.json` from the synthetic two-account provider, through the plugin's own handlers.
 *
 *   npm run fixtures
 *
 * The provider is deterministic, so every recorded answer can be rebuilt. A plugin with real accounts records with
 * `npx plugin-kit record --account <alias>` instead; this script stays because its accounts are synthetic by design.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { manifest, packageName } from "../src/manifest.js"
import { refusal, run, runtimeFor } from "../test/support/handlers.js"

const runtime = runtimeFor()
const since = "2026-11-01T00:00:00.000Z"
const events = (input: Record<string, unknown>, account: string) => run(runtime, "events_list", input, account)

// A page names the owner its account's last probe read, so both aliases are probed before any page.
const probeWork = await run(runtime, "probe", { source: "recordings" }, "work")
const probePersonal = await run(runtime, "probe", { source: "recordings" }, "personal")

const workPage = (await events({ source: "recordings", since }, "work")) as { cursor: string }
const personalPage = await events({ source: "recordings", since }, "personal")
const emptyPage = await events({ source: "recordings", since: "2026-11-20T00:00:00.000Z" }, "work")
const cursorRefusal = await refusal(events({ source: "recordings", account: "personal", cursor: workPage.cursor }, "personal"))
const sourceRefusal = await refusal(events({ source: "other" }, "work"))

const recentWork = await run(runtime, "recent", { limit: 3 }, "work")
const status = await run(runtime, "status", {})

const fixture = {
  $comment:
    "Recorded from the synthetic two-account Plaud provider through the plugin's own handlers: events, a list snapshot, probe and status. Every owner and recording is invented; the vendor's MCP tools are declared as mcp:<tool> and have no handler.",
  plugin: packageName,
  namespace: manifest.plugin.summary,
  accounts: {
    real: false,
    aliases: ["work", "personal"],
    required: { method: "plan_export", code: "ACCOUNT_REQUIRED" },
    unknown: { method: "plan_export", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
    cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
  },
  sources: {
    "plaud.recordings": {
      cases: [
        { input: { source: "recordings", account: "work", since }, expect: "page", answer: workPage },
        { input: { source: "recordings", account: "personal", since }, expect: "page", answer: personalPage },
        { input: { source: "recordings", account: "work", since: "2026-11-20T00:00:00.000Z" }, expect: "empty", answer: emptyPage },
        {
          input: { source: "recordings", account: "personal", cursor: workPage.cursor },
          expect: "CURSOR_INVALID",
          refuses: cursorRefusal,
        },
        { input: { source: "other", account: "work" }, expect: "SOURCE_UNKNOWN", refuses: sourceRefusal },
      ],
      probe: { input: { source: "recordings", account: "work" }, answer: probeWork },
    },
    "plaud.recent": {
      probe: { input: { source: "recordings", account: "work" }, answer: probeWork },
      snapshot: { input: { limit: 3, account: "work" }, answer: recentWork },
    },
  },
  events: { emitted: [], status },
  actions: [],
  rpc: { inputs: { plan_export: { recordingId: "w-1", kind: "note" } } },
}
mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`recorded fixtures/conformance.json for ${packageName}`)
