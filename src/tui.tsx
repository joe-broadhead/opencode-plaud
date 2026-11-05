import type { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { For, Show, createSignal } from "solid-js"
import { Plaud, isStatus, statusLines, type Status, type Tone } from "./rpc.js"

/**
 * The TUI part: one palette command, "Plaud: Status" (`/plaud`), that opens a dialog
 * with each account's state and the next step. It reads the plugin's
 * `status` RPC and shows the same lines as `/plaud-status`. While the dialog
 * is open, the status is read again when the server reconnects, when a
 * Plaud server's state changes, and when an agent, an integration or a
 * credential changes. The 2.2.x TUI
 * receives no `mcp.tools.changed` event; a server's tools change when it
 * connects, which `mcp.status.changed` reports.
 */

export const TUI_ID = "plaud.recordings.tui"
export const STATUS_COMMAND = "plaud.recordings.status"

/** The plugin's servers: `plaud` and `plaud-<alias>`. */
const PLAUD_SERVER = /^plaud(-|$)/
const RETRY = "Run /plaud-status in a session. If that fails too, open /plugins and check plaud.recordings."

type View =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly status: Status }
  | { readonly state: "unavailable"; readonly message: string; readonly nextStep: string }

type Theme = Plugin.Context["theme"]

/**
 * The RPC client rejects with `{ type, message, data }`. The declared
 * `unavailable` error carries a next step; any other failure, such as the
 * server part not running, gets the generic one.
 */
export function unavailable(error: unknown): View {
  const known = typeof error === "object" && error !== null
  const message = known && "message" in error ? `${error.message}` : `${error}`
  const data = known && "data" in error ? error.data : undefined
  const declared = typeof data === "object" && data !== null && "nextStep" in data ? data.nextStep : undefined
  return { state: "unavailable", message, nextStep: typeof declared === "string" ? declared : RETRY }
}

function color(theme: Theme, tone: Tone) {
  switch (tone) {
    case "ok":
      return theme.text.feedback.success.base
    case "warning":
      return theme.text.feedback.warning.base
    case "error":
      return theme.text.feedback.error.base
    case "info":
      return theme.text.base
  }
}

function Row(props: { readonly label: string; readonly value: string; readonly tone: Tone; readonly width: number; readonly theme: Theme }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.theme.text.muted} width={props.width} flexShrink={0}>
        {props.label}
      </text>
      <text fg={color(props.theme, props.tone)} flexGrow={1} wrapMode="word">
        {props.value}
      </text>
    </box>
  )
}

function StatusDialog(props: {
  readonly context: Plugin.Context
  readonly view: View
  readonly refreshing: boolean
  readonly refresh: () => void
}) {
  // Created inside the dialog, so the host removes the layer when the dialog closes.
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { id: "plaud.recordings.status.refresh", title: "Refresh Plaud status", group: "Plaud", bind: "r", run: () => props.refresh() },
      { title: "Close Plaud status", group: "Plaud", bind: "escape", run: () => props.context.ui.dialog.clear() },
    ],
  }))
  const theme = (): Theme => props.context.theme.surface("dialog")
  const status = () => (props.view.state === "ready" ? props.view.status : undefined)
  const failure = () => (props.view.state === "unavailable" ? props.view : undefined)
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().text.base} attributes={TextAttributes.BOLD}>
          Plaud status
        </text>
        <text fg={theme().text.muted}>{props.refreshing && props.view.state !== "loading" ? "refreshing…" : "r refresh · esc close"}</text>
      </box>
      <Show when={props.view.state === "loading"}>
        <text fg={theme().text.muted}>Reading Plaud's status…</text>
      </Show>
      <Show when={status()}>
        {(current: () => Status) => {
          const lines = () => statusLines(current())
          const width = () => Math.min(28, Math.max(...lines().map((line) => line.label.length)))
          return (
            <box flexDirection="column">
              <For each={lines()}>
                {(line) => (
                  <>
                    <Row label={line.label} value={line.value} tone={line.tone} width={width()} theme={theme()} />
                    <Show when={line.block}>
                      {(block: () => string) => (
                        <box marginTop={1} marginBottom={1}>
                          <text fg={theme().text.muted} wrapMode="word">
                            {block()}
                          </text>
                        </box>
                      )}
                    </Show>
                  </>
                )}
              </For>
            </box>
          )
        }}
      </Show>
      <Show when={failure()}>
        {(failed: () => Extract<View, { state: "unavailable" }>) => (
          <box flexDirection="column">
            <text fg={theme().text.feedback.error.base}>Plaud's status is unavailable</text>
            <text fg={theme().text.muted} wrapMode="word">
              {failed().message}
            </text>
            <Row label="Next step" value={failed().nextStep} tone="info" width={9} theme={theme()} />
          </box>
        )}
      </Show>
    </box>
  )
}

const plugin: Plugin.Definition = {
  id: TUI_ID,
  setup(context) {
    const [view, setView] = createSignal<View>({ state: "loading" })
    const [refreshing, setRefreshing] = createSignal(false)
    let controller: AbortController | undefined
    let disposed = false
    // Identifies the open dialog; showing another dialog closes this one.
    let open: object | undefined
    // The event listeners of the open dialog.
    let stops: (() => void)[] = []

    const close = () => {
      controller?.abort()
      for (const stop of stops.splice(0)) stop()
      open = undefined
    }

    const refresh = () => {
      if (disposed) return
      controller?.abort()
      const current = new AbortController()
      controller = current
      setRefreshing(true)
      // Read the client per call: it changes after the server restarts.
      void context.client
        .rpc(Plaud)
        .status({}, { location: context.location ?? context.data.location.default(), signal: current.signal })
        .then((value): View => (isStatus(value) ? { state: "ready", status: value } : unavailable(new Error("The status had an unexpected shape."))), unavailable)
        .then((next) => {
          // A newer request, or the cleanup, has taken over.
          if (current.signal.aborted) return
          setView(next)
          setRefreshing(false)
        })
    }

    const show = () => {
      if (disposed) return
      close()
      const token = {}
      context.ui.dialog.show(
        () => <StatusDialog context={context} view={view()} refreshing={refreshing()} refresh={refresh} />,
        () => {
          if (open === token) close()
        },
      )
      context.ui.dialog.set({ size: "large" })
      open = token
      setView({ state: "loading" })
      stops = [
        context.data.on("server.connected", () => refresh()),
        context.data.on("mcp.status.changed", (event) => {
          if (PLAUD_SERVER.test(event.data.server)) refresh()
        }),
        context.data.on("agent.updated", () => refresh()),
        context.data.on("integration.updated", () => refresh()),
        context.data.on("credential.updated", () => refresh()),
        context.data.on("credential.switched", () => refresh()),
      ]
      refresh()
    }

    // Registered from setup, outside any root of the plugin's own, so the host's keymap
    // owns it. Global, so the palette lists it from every screen.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: STATUS_COMMAND,
          title: "Plaud: Status",
          description: "Show each Plaud account's sign-in state and the next step",
          group: "Plaud",
          palette: true,
          slash: { name: "plaud" },
          run: show,
        },
      ],
    }))

    return () => {
      if (disposed) return
      disposed = true
      if (open) context.ui.dialog.clear()
      close()
    }
  },
}

export default plugin
