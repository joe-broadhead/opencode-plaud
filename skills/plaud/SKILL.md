---
name: plaud
description: >
  Find and read a person's Plaud recordings: the newest ones as a list, a page of recordings as events, and whose an
  account is. Use for Plaud voice recordings; not for other meeting recorders, and not for writing or sending anything.
---

# Plaud

Use this plugin when a person wants to find or read what their Plaud device recorded. A recording is a meeting with a
title, a start time and a length; its transcript and its note belong to it.

## Pick an account

The plugin serves the aliases the person configured, such as `default` and `work`. With more than one, pass `account` on
every call. Without one the call is refused with `ACCOUNT_REQUIRED`; an alias the plugin does not serve is
`ACCOUNT_UNKNOWN`, and the next step lists the aliases it does.

## Read

- `tools.plaud.recent` lists the newest recordings of one account, newest first, one line each, and each item's id is
  the recording's id. Start here: it answers the title, start time and length a person asks about.
- `tools.plaud.events_list` lists recordings as events, oldest first, since a cursor. Use it for a window of time or for
  an automation, not for a quick answer; pass the `cursor` a page returned to read what follows it.
- `tools.plaud.probe` reads whose the account is, and nothing recorded. Call it after a restart, before the first
  `events_list` of an account: a page names its owner.
- `tools.plaud.status` reports the plugin's version, host, aliases and any next step. It needs no account.

Plaud's own MCP tools are there too, as the account server's tools (`list_files`, `get_file`, `get_note`,
`get_transcript`, `get_current_user`). Prefer the plugin's methods: they take an account, bind the cursor and mark the
answer untrusted.

To read a recording's content, export it: `tools.plaud.plan_export` then `tools.plaud.export` (see the `plaud-export`
skill). Nothing in this plugin reads a transcript or note into the conversation.

## Access

`all` runs every read and the export without asking. `ask-changes` asks before each export and runs every read.
`read-only` refuses the export. A read never asks.

## Errors

- `ACCOUNT_REQUIRED` — pass `account` with one of the aliases.
- `ACCOUNT_UNKNOWN` — use an alias the plugin serves.
- `NEEDS_SIGN_IN` — sign in to the server `plaud` or `plaud-<alias>` through OpenCode's MCP sign-in.
- `CURSOR_INVALID` — read again without the cursor; never reuse another account's cursor.
- `UNAVAILABLE` — Plaud or its storage could not be read; read `status` and follow its next step.
- `SOURCE_UNKNOWN` — this plugin has one events source, `recordings`; omit `source`.
