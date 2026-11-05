// Render smoke test of the built TUI part, dist/tui.js, on OpenTUI 0.8's test renderer with a fake TUI
// context. test/tui.test.ts runs it after `npm run build`:
//   bun --conditions=browser test/tui-renderer.mjs
// The browser condition loads Solid's reactive build, as the OpenCode TUI does.
import assert from "node:assert/strict"

const { createComponent, createSignal, Show } = await import("solid-js")
const { createElement, insert, testRender } = await import("@opentui/solid")
const { default: plugin, STATUS_COMMAND, TUI_ID } = await import("../dist/tui.js")
const { RPC_ID, rulesBlock, statusLines } = await import("../src/rpc.ts")

const RULES = [
  { action: "plaud*_*", resource: "*", effect: "ask" },
  { action: "plaud_list_files", resource: "*", effect: "allow" },
  { action: "plaud_get_file", resource: "*", effect: "allow" },
  { action: "plaud_get_note", resource: "*", effect: "allow" },
  { action: "plaud_get_transcript", resource: "*", effect: "allow" },
  { action: "plaud_get_current_user", resource: "*", effect: "allow" },
  { action: "plaud_export", resource: "*", effect: "ask" },
]
const RANGE = ">=2.2.3 <2.3.0"
const status = (overrides = {}) => ({
  version: "0.0.0-test",
  state: "sign_in_required",
  accounts: [
    { account: "default", server: "plaud", state: "sign_in_needed" },
    { account: "work", server: "plaud-work", state: "signed_in" },
  ],
  exportRoots: ["/fixture/Plaud"],
  tools: { visible: 6, unknown: 0, unknownNames: [] },
  host: { version: "2.2.3", range: RANGE, tested: true },
  unguardedAgents: [],
  permissionsBlock: RULES,
  shadowedSkills: [],
  nextStep: "Run /connect and choose Plaud, then press o or Enter to open the sign-in page.",
  ...overrides,
})
const signedIn = status({
  state: "connected",
  accounts: [{ account: "default", server: "plaud", state: "signed_in" }],
  nextStep: "Nothing to do.",
})
const attention = status({
  host: { version: "2.3.0", range: RANGE, tested: false },
  tools: { visible: 11, unknown: 1, unknownNames: ["delete_file"] },
  unguardedAgents: ["reviewer"],
  nextStep: "Agent reviewer did not get Plaud's default permission rules.",
})

const requests = []
const handlers = new Map()
const layers = []
let dialogSize
const [dialog, setDialog] = createSignal()
const theme = {
  text: {
    base: "#ffffff",
    muted: "#888888",
    faint: "#666666",
    feedback: { success: { base: "#00ff00" }, warning: { base: "#ffff00" }, error: { base: "#ff0000" } },
  },
}
theme.surface = () => theme
const context = {
  location: { directory: "/fixture/project" },
  theme,
  client: {
    rpc: (definition) => ({
      status: (input, options) => new Promise((resolve, reject) => requests.push({ definition, input, options, resolve, reject })),
    }),
  },
  data: {
    location: { default: () => ({ directory: "/fixture/default" }) },
    on: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type).add(handler)
      return () => handlers.get(type).delete(handler)
    },
  },
  keymap: { layer: (factory) => layers.push(factory()) },
  ui: {
    dialog: {
      // Like the host, showing a dialog closes the one before.
      show: (render, onClose) => {
        const before = dialog()
        setDialog(() => ({ render, onClose }))
        before?.onClose?.()
      },
      set: (options) => (dialogSize = options.size),
      clear: () => {
        const open = dialog()
        setDialog(undefined)
        open?.onClose?.()
      },
    },
  },
}
const emit = (type, data = {}) => {
  for (const handler of [...(handlers.get(type) ?? [])]) handler({ type, data })
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const squash = (text) => text.replace(/\s+/g, "")

const listeners = () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0)

assert.equal(TUI_ID, "plaud.recordings.tui")
const cleanup = plugin.setup(context)
// Nothing is read or watched until the dialog opens.
assert.equal(requests.length, 0)
assert.equal(listeners(), 0)

const palette = layers.flatMap((layer) => (layer.mode === "global" ? layer.commands : []))
assert.equal(palette.length, 1)
assert.equal(palette[0].id, STATUS_COMMAND)
assert.equal(palette[0].title, "Plaud: Status")
assert.equal(palette[0].palette, true)
assert.deepEqual(palette[0].slash, { name: "plaud" })

let view
try {
  view = await testRender(() => {
    const root = createElement("box")
    insert(root, createComponent(Show, { get when() { return dialog() }, children: (open) => open().render() }))
    return root
  }, { width: 120, height: 40 })
  const frame = async () => {
    await settle()
    await view.flush()
    return view.captureCharFrame()
  }

  // The palette command opens the dialog, which reads the status and shows the shared lines.
  palette[0].run()
  assert.equal(dialogSize, "large")
  assert.equal(requests.length, 1)
  assert.equal(requests[0].definition.id, RPC_ID)
  assert.deepEqual(requests[0].input, {})
  assert.deepEqual(requests[0].options.location, context.location)
  assert.match(await frame(), /Reading Plaud's status…/)
  requests[0].resolve(attention)
  const shown = squash(await frame())
  assert.match(shown, /Plaudstatus/)
  assert.ok(shown.includes(squash("r refresh · esc close")), "key hint")
  for (const line of statusLines(attention)) {
    assert.ok(shown.includes(squash(line.label)), `dialog lacks label ${line.label}`)
    assert.ok(shown.includes(squash(line.value)), `dialog lacks ${line.value}`)
  }
  assert.ok(shown.includes(squash(rulesBlock(attention))), "dialog lacks the rules to copy")
  assert.ok(shown.indexOf(squash(rulesBlock(attention))) < shown.indexOf("Nextstep"), "the rules come before the next step")

  // Refresh triggers while open: only Plaud servers' MCP changes, reconnects, agents, integrations and credentials.
  emit("mcp.status.changed", { server: "github" })
  assert.equal(requests.length, 1)
  emit("mcp.status.changed", { server: "plaud-work" })
  emit("server.connected")
  emit("agent.updated")
  emit("integration.updated")
  emit("credential.updated")
  emit("credential.switched")
  assert.equal(requests.length, 7)
  assert.deepEqual(requests.slice(1, 6).map((request) => request.options.signal.aborted), [true, true, true, true, true])
  requests[6].resolve(signedIn)
  requests[5].reject(new Error("superseded"))
  assert.match(await frame(), /Next step\s+Nothing to do\./)

  // r refreshes; escape closes the dialog and stops watching.
  const modal = layers.filter((layer) => layer.mode === "modal").at(-1).commands
  modal.find((command) => command.bind === "r").run()
  assert.equal(requests.length, 8)
  requests[7].resolve(status())
  assert.match(await frame(), /sign-in required/)
  modal.find((command) => command.bind === "escape").run()
  assert.doesNotMatch(await frame(), /Plaud status/)
  assert.equal(listeners(), 0)
  emit("server.connected")
  assert.equal(requests.length, 8)

  // A declared error shows its next step; any other failure the generic one.
  palette[0].run()
  requests[8].reject({ type: "unavailable", message: "STATUS_UNAVAILABLE: Plaud's status could not be read (boom).", data: { nextStep: "Try again in a few seconds." } })
  let failed = await frame()
  assert.match(failed, /Plaud's status is unavailable/)
  assert.match(failed, /Try again in a few seconds\./)
  palette[0].run()
  requests[9].reject({ type: "rpc.unavailable", message: "no handler" })
  failed = squash(await frame())
  assert.ok(failed.includes(squash("Run /plaud-status in a session.")), "generic next step missing")

  // Cleanup: every listener is released, the open dialog closes, and nothing reads again.
  const retained = [...handlers.get("server.connected")]
  assert.equal(retained.length, 1)
  cleanup()
  cleanup()
  assert.equal(listeners(), 0)
  assert.equal(dialog(), undefined)
  for (const handler of retained) handler({ type: "server.connected", data: {} })
  assert.equal(requests.length, 10)
  assert.doesNotMatch(await frame(), /Plaud/)
  console.log("PASS dist/tui.js renders the status dialog on OpenTUI 0.8")
} finally {
  cleanup?.()
  await view?.dispose()
}
