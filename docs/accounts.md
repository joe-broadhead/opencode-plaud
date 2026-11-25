# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: Plaud's own MCP server holds the credentials. OpenCode adds one remote server per alias on the
one endpoint in `src/provider/` (or `options.url`), named `plaud` for `default` and `plaud-<alias>` otherwise. Each has
its own OAuth, so two aliases are two independent sign-ins. Sign in through OpenCode's MCP sign-in, once per alias.

The plugin never receives OpenCode's stored sign-in material: OpenCode stores and refreshes it per server.

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With one alias it may be left out. With more than one and no
account, the call is refused with `ACCOUNT_REQUIRED`, whose next step lists the aliases; an alias the plugin does not
serve is `ACCOUNT_UNKNOWN`.

Cursors are bound to the account. A cursor issued for `work` and passed with `personal` is `CURSOR_INVALID`, never a
silent restart.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`, and the owner
once `probe` has named it. The state comes from OpenCode's own MCP list: connected is `ready`, a sign-in needed is
`needs_sign_in`, a failed or disabled server is `error` with a redacted one-line reason.

## Pass-through tools

Plaud's own MCP tools are per server, so one alias's tool never reaches another's: `plaud-work_list_files` is `work`'s
and `plaud-personal_list_files` is `personal`'s. A session fenced to one alias is denied the other's tool with
`PERMISSION_DENIED`.
