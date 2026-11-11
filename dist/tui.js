// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { For, Show, createSignal } from "solid-js";

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var RPC_ID = "plaud.recordings";
var ACCOUNT_STATES = ["signed_in", "sign_in_needed", "connecting", "failed", "disabled", "missing"];
var STATES = ["connected", "sign_in_required", "connecting", "failed", "disabled", "not_configured"];
var text = { type: "string" };
var texts = { type: "array", items: text };
var integer = { type: "integer" };
var flag = { type: "boolean" };
var object = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
var rule = object({ action: text, resource: text, effect: { enum: ["allow", "ask", "deny"] } }, ["action", "resource", "effect"]);
var account = object(
  { account: text, server: text, state: { enum: [...ACCOUNT_STATES] }, reason: text, userServer: flag },
  ["account", "server", "state"]
);
var StatusSchema = object(
  {
    version: text,
    state: { enum: [...STATES] },
    access: { enum: ["all", "ask-changes", "read-only"] },
    accounts: { type: "array", items: account },
    exportRoots: texts,
    tools: object({ visible: integer, unknown: integer, unknownNames: texts }, ["visible", "unknown", "unknownNames"]),
    host: object({ version: { type: ["string", "null"] }, range: text, tested: flag }, ["version", "range", "tested"]),
    unguardedAgents: texts,
    permissionsBlock: { type: "array", items: rule },
    shadowedSkills: { type: "array", items: object({ id: text, path: text }, ["id", "path"]) },
    nextStep: text
  },
  ["version", "state", "access", "accounts", "exportRoots", "tools", "host", "unguardedAgents", "permissionsBlock", "shadowedSkills", "nextStep"]
);
var Plaud = Rpc.define({
  id: RPC_ID,
  methods: {
    status: {
      input: object({}, []),
      output: StatusSchema,
      errors: { unavailable: object({ nextStep: text }, ["nextStep"]) }
    }
  },
  events: {}
});
function isStatus(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  const tools = candidate.tools;
  const host = candidate.host;
  return typeof candidate.version === "string" && STATES.includes(candidate.state) && (candidate.access === "all" || candidate.access === "ask-changes" || candidate.access === "read-only") && Array.isArray(candidate.accounts) && Array.isArray(candidate.exportRoots) && Array.isArray(candidate.unguardedAgents) && Array.isArray(candidate.permissionsBlock) && Array.isArray(candidate.shadowedSkills) && typeof candidate.nextStep === "string" && typeof tools?.visible === "number" && typeof tools.unknown === "number" && Array.isArray(tools.unknownNames) && (typeof host?.version === "string" || host?.version === null) && typeof host.range === "string" && typeof host.tested === "boolean";
}
var STATE_TEXT = {
  signed_in: "connected",
  sign_in_needed: "sign-in required",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  missing: "not configured"
};
var STATE_TONE = {
  signed_in: "ok",
  sign_in_needed: "warning",
  connecting: "info",
  failed: "error",
  disabled: "warning",
  missing: "error"
};
var URGENCY = ["sign_in_needed", "failed", "missing", "disabled", "connecting", "signed_in"];
function overallState(status) {
  const states = new Set(status.accounts.map((account2) => account2.state));
  return URGENCY.find((state) => states.has(state)) ?? "signed_in";
}
function accessText(status) {
  const roots = status.exportRoots.join(", ");
  if (status.access === "all") return `Every tool runs without asking. Exports write only in ${roots}.`;
  if (status.access === "read-only") return `Reads run without asking. Exports are denied, so nothing is written to ${roots}.`;
  return `Reads run without asking. Exports ask, and write only in ${roots}.`;
}
var unknownPosture = (access) => access === "all" ? "new tools run too" : access === "read-only" ? "they are denied" : "they ask before running";
function statusLines(status) {
  const several = status.accounts.length > 1;
  const connection = status.accounts.map(
    (account2) => [`${several ? `${account2.account}: ` : ""}${STATE_TEXT[account2.state]}`, ...account2.reason === void 0 ? [] : [` (${account2.reason})`]].join("")
  );
  const lines = [
    { label: "Connection", value: connection.join("; "), tone: STATE_TONE[overallState(status)] },
    {
      label: "Account",
      value: status.accounts.map((account2) => `${account2.account} (server ${account2.server}${account2.userServer ? ", from your OpenCode config" : ""})`).join(", "),
      tone: "info"
    },
    { label: "Access", value: accessText(status), tone: "info" }
  ];
  if (status.shadowedSkills.length > 0) {
    lines.push({
      label: "Skills",
      value: status.shadowedSkills.map((skill) => `${skill.id} is shadowed by ${skill.path}, so agents load that file instead of this plugin's skill`).join("; "),
      tone: "warning"
    });
  }
  const { visible, unknown, unknownNames } = status.tools;
  lines.push({
    label: "Tools",
    value: `${visible} available${unknown === 0 ? "" : `, ${unknown} unknown${unknownNames.length === 0 ? "" : `: ${unknownNames.join(", ")}`} (${unknownPosture(status.access)})`}`,
    tone: "info"
  });
  const block = rulesBlock(status);
  lines.push(
    block === void 0 ? { label: "Agents without default rules", value: "none", tone: "info" } : {
      label: "Agents without default rules",
      value: status.unguardedAgents.join(", "),
      tone: "warning",
      block
    }
  );
  const { host } = status;
  lines.push({
    label: "OpenCode",
    value: `${host.version ?? "unknown version"} (${host.tested ? "tested" : "untested"}; supported range ${host.range})`,
    tone: host.tested ? "info" : "warning"
  });
  lines.push({ label: "Next step", value: status.nextStep, tone: "info" });
  return lines;
}
function rulesBlock(status) {
  if (status.unguardedAgents.length === 0) return void 0;
  return `[
${status.permissionsBlock.map((rule2) => `  ${JSON.stringify(rule2)}`).join(",\n")}
]`;
}

// src/tui.tsx
var TUI_ID = "plaud.recordings.tui";
var STATUS_COMMAND = "plaud.recordings.status";
var PLAUD_SERVER = /^plaud(-|$)/;
var RETRY = "Run /plaud-status in a session. If that fails too, open /plugins and check plaud.recordings.";
function unavailable(error) {
  const known = typeof error === "object" && error !== null;
  const message = known && "message" in error ? `${error.message}` : `${error}`;
  const data = known && "data" in error ? error.data : void 0;
  const declared = typeof data === "object" && data !== null && "nextStep" in data ? data.nextStep : void 0;
  return {
    state: "unavailable",
    message,
    nextStep: typeof declared === "string" ? declared : RETRY
  };
}
function color(theme, tone) {
  switch (tone) {
    case "ok":
      return theme.text.feedback.success.base;
    case "warning":
      return theme.text.feedback.warning.base;
    case "error":
      return theme.text.feedback.error.base;
    case "info":
      return theme.text.base;
  }
}
function Row(props) {
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$2, "flexShrink", 0);
    _$insert(_el$2, () => props.label);
    _$setProp(_el$3, "flexGrow", 1);
    _$setProp(_el$3, "wrapMode", "word");
    _$insert(_el$3, () => props.value);
    _$effect((_p$) => {
      var _v$ = props.theme.text.muted, _v$2 = props.width, _v$3 = color(props.theme, props.tone);
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "width", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$3, "fg", _v$3, _p$.a));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$;
  })();
}
function StatusDialog(props) {
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [{
      id: "plaud.recordings.status.refresh",
      title: "Refresh Plaud status",
      group: "Plaud",
      bind: "r",
      run: () => props.refresh()
    }, {
      title: "Close Plaud status",
      group: "Plaud",
      bind: "escape",
      run: () => props.context.ui.dialog.clear()
    }]
  }));
  const theme = () => props.context.theme.surface("dialog");
  const status = () => props.view.state === "ready" ? props.view.status : void 0;
  const failure = () => props.view.state === "unavailable" ? props.view : void 0;
  return (() => {
    var _el$4 = _$createElement("box"), _el$5 = _$createElement("box"), _el$6 = _$createElement("text"), _el$8 = _$createElement("text");
    _$insertNode(_el$4, _el$5);
    _$setProp(_el$4, "flexDirection", "column");
    _$setProp(_el$4, "gap", 1);
    _$setProp(_el$4, "paddingLeft", 2);
    _$setProp(_el$4, "paddingRight", 2);
    _$setProp(_el$4, "paddingBottom", 1);
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$8);
    _$setProp(_el$5, "flexDirection", "row");
    _$setProp(_el$5, "justifyContent", "space-between");
    _$insertNode(_el$6, _$createTextNode(`Plaud status`));
    _$insert(_el$8, () => props.refreshing && props.view.state !== "loading" ? "refreshing\u2026" : "r refresh \xB7 esc close");
    _$insert(_el$4, _$createComponent(Show, {
      get when() {
        return props.view.state === "loading";
      },
      get children() {
        var _el$9 = _$createElement("text");
        _$insertNode(_el$9, _$createTextNode(`Reading Plaud's status\u2026`));
        _$effect((_$p) => _$setProp(_el$9, "fg", theme().text.muted, _$p));
        return _el$9;
      }
    }), null);
    _$insert(_el$4, _$createComponent(Show, {
      get when() {
        return status();
      },
      children: (current) => {
        const lines = () => statusLines(current());
        const width = () => Math.min(28, Math.max(...lines().map((line) => line.label.length)));
        return (() => {
          var _el$1 = _$createElement("box");
          _$setProp(_el$1, "flexDirection", "column");
          _$insert(_el$1, _$createComponent(For, {
            get each() {
              return lines();
            },
            children: (line) => [_$createComponent(Row, {
              get label() {
                return line.label;
              },
              get value() {
                return line.value;
              },
              get tone() {
                return line.tone;
              },
              get width() {
                return width();
              },
              get theme() {
                return theme();
              }
            }), _$createComponent(Show, {
              get when() {
                return line.block;
              },
              children: (block) => (() => {
                var _el$10 = _$createElement("box"), _el$11 = _$createElement("text");
                _$insertNode(_el$10, _el$11);
                _$setProp(_el$10, "marginTop", 1);
                _$setProp(_el$10, "marginBottom", 1);
                _$setProp(_el$11, "wrapMode", "word");
                _$insert(_el$11, block);
                _$effect((_$p) => _$setProp(_el$11, "fg", theme().text.muted, _$p));
                return _el$10;
              })()
            })]
          }));
          return _el$1;
        })();
      }
    }), null);
    _$insert(_el$4, _$createComponent(Show, {
      get when() {
        return failure();
      },
      children: (failed) => (() => {
        var _el$12 = _$createElement("box"), _el$13 = _$createElement("text"), _el$15 = _$createElement("text");
        _$insertNode(_el$12, _el$13);
        _$insertNode(_el$12, _el$15);
        _$setProp(_el$12, "flexDirection", "column");
        _$insertNode(_el$13, _$createTextNode(`Plaud's status is unavailable`));
        _$setProp(_el$15, "wrapMode", "word");
        _$insert(_el$15, () => failed().message);
        _$insert(_el$12, _$createComponent(Row, {
          label: "Next step",
          get value() {
            return failed().nextStep;
          },
          tone: "info",
          width: 9,
          get theme() {
            return theme();
          }
        }), null);
        _$effect((_p$) => {
          var _v$7 = theme().text.feedback.error.base, _v$8 = theme().text.muted;
          _v$7 !== _p$.e && (_p$.e = _$setProp(_el$13, "fg", _v$7, _p$.e));
          _v$8 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$8, _p$.t));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$12;
      })()
    }), null);
    _$effect((_p$) => {
      var _v$4 = theme().text.base, _v$5 = TextAttributes.BOLD, _v$6 = theme().text.muted;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$6, "fg", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$6, "attributes", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp(_el$8, "fg", _v$6, _p$.a));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$4;
  })();
}
var plugin = {
  id: TUI_ID,
  setup(context) {
    const [view, setView] = createSignal({
      state: "loading"
    });
    const [refreshing, setRefreshing] = createSignal(false);
    let controller;
    let disposed = false;
    let open;
    let stops = [];
    const close = () => {
      controller?.abort();
      for (const stop of stops.splice(0)) stop();
      open = void 0;
    };
    const refresh = () => {
      if (disposed) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setRefreshing(true);
      void context.client.rpc(Plaud).status({}, {
        location: context.location ?? context.data.location.default(),
        signal: current.signal
      }).then((value) => isStatus(value) ? {
        state: "ready",
        status: value
      } : unavailable(new Error("The status had an unexpected shape.")), unavailable).then((next) => {
        if (current.signal.aborted) return;
        setView(next);
        setRefreshing(false);
      });
    };
    const show = () => {
      if (disposed) return;
      close();
      const token = {};
      context.ui.dialog.show(() => _$createComponent(StatusDialog, {
        context,
        get view() {
          return view();
        },
        get refreshing() {
          return refreshing();
        },
        refresh
      }), () => {
        if (open === token) close();
      });
      context.ui.dialog.set({
        size: "large"
      });
      open = token;
      setView({
        state: "loading"
      });
      stops = [context.data.on("server.connected", () => refresh()), context.data.on("mcp.status.changed", (event) => {
        if (PLAUD_SERVER.test(event.data.server)) refresh();
      }), context.data.on("agent.updated", () => refresh()), context.data.on("integration.updated", () => refresh()), context.data.on("credential.updated", () => refresh()), context.data.on("credential.switched", () => refresh())];
      refresh();
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: STATUS_COMMAND,
        title: "Plaud: Status",
        description: "Show each Plaud account's sign-in state and the next step",
        group: "Plaud",
        palette: true,
        slash: {
          name: "plaud"
        },
        run: show
      }]
    }));
    return () => {
      if (disposed) return;
      disposed = true;
      if (open) context.ui.dialog.clear();
      close();
    };
  }
};
var tui_default = plugin;
export {
  STATUS_COMMAND,
  TUI_ID,
  tui_default as default,
  unavailable
};
