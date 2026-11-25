# Automations

Plaud records on the device and uploads when the Plaud app connects, so a timer is for the person who wants new
recordings noticed, not for catching one the moment it happens. An events source is read on a timer with a cursor in
the automation's state.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `plaud.recordings` | `tools.plaud.events_list` | — | 15 min | — |
<!-- /generated:automations -->

## The recipe

1. Read `tools.plaud.events_list` with the account and the cursor saved by the previous run.
2. Apply the page's events, apply its `removals`, then save the `cursor` it answers in the automation's state.
3. If `failed` is not empty, keep the old cursor: a failed event holds the read back. `refused[]` does not: those events
   are never delivered, and the cursor has moved past them.
4. Read again on the suggested cadence. `more: true` means another page is ready now, not that the source is done.
5. When a page carries `gap: { reason: "expired", since }`, a recording reached Plaud more than two weeks after it
   started: report the gap and read again from `since`, rather than inventing the missing recordings.

```ts
// The automation's state holds one cursor per account.
const page = await tools.plaud.events_list({ source: "recordings", account: "work", cursor: state.cursor })
state.cursor = page.cursor
```

A cursor is bound to its plugin, source, account and scope. Do not share one between accounts: the plugin refuses it
with `CURSOR_INVALID`. A listing names its owner, so call `tools.plaud.probe` once per account after a restart, before
the first listing.
