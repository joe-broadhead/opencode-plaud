# Scripting

Unofficial plugin. Not affiliated with Plaud.

A script can read Plaud with no model: a cron job, a shell script, or any program that can reach the OpenCode server.
It uses the tools RPC, `plaud.recordings.tools`, through `opencode api` or an OpenCode client.

| Method | The tool, for the default account |
| --- | --- |
| `list_files` | `plaud_list_files` |
| `get_file` | `plaud_get_file` |
| `get_note` | `plaud_get_note` |
| `get_transcript` | `plaud_get_transcript` |
| `get_current_user` | `plaud_get_current_user` |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

Each method runs Plaud's own read tool with the same input, through OpenCode's own connection and sign-in. The plugin
never sees the token. Durations stay in milliseconds, as Plaud returns them.

These are never methods, even with an allow rule:

- the plugin's own `plaud_export`, which writes a local file;
- any other tool on a Plaud server, including any tool that Plaud adds later.

## Accounts

The default account's reads run on the `plaud` server. To read another account, add `account` with its alias from the
plugin's `accounts` option: `"account": "work"` runs `plaud-work_list_files` and so on. `"account": "default"` is the
default account, the same as leaving `account` out. An account that is not in the options is refused with
`ACCOUNT_UNKNOWN`. If your OpenCode config defines its own server under an account's name, such as `plaud-work`, the
call uses it, as the model and `plaud_export` do.

`describe` shows the default account's tools. Every account's server has the same five reads.

## Signed links

Plaud's results carry signed links: `presigned_url` to a recording's audio, and `data_link` to each source and note
item. Anyone who has one can download what it points to until it expires. A script never gets one: the plugin replaces
each, in the structured output and in the text, with the same notice the model sees. Use `plaud_export`, from a
session with the model, to save audio, a transcript or a note.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the access
its model would have:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `plaud_get_file` or `plaud-work_get_file`, on resource `*` is a
  `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the five reads, so an agent with the default rules needs nothing more. An
  agent defined only in your config misses the default rules; `/plaud-status` names it and gives the fix.

Create the session once, with the agent the script runs as, and keep its id:

```sh
opencode api post /api/session -d '{"title":"weekly recordings","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can list the default
account's recordings and read their notes, and nothing else:

```sh
opencode api post /api/session -d '{"title":"weekly notes","agent":"build","permissions":[
  {"action":"plaud*_*","resource":"*","effect":"deny"},
  {"action":"plaud_list_files","resource":"*","effect":"allow"},
  {"action":"plaud_get_note","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "account": "<alias>", "input": <the tool's input>}}`. `sessionID`
and `input` are required, `account` is optional, and no other key is allowed:

```sh
opencode api post /api/rpc/plaud.recordings.tools/list_files -d '{"input":{
  "sessionID":"ses_…",
  "input":{"page_size":10}
}}'

opencode api post /api/rpc/plaud.recordings.tools/get_note -d '{"input":{
  "sessionID":"ses_…",
  "account":"work",
  "input":{"file_id":"…"}
}}'
```

The tool's input is Plaud's: `describe` shows each tool's schema as OpenCode lists it now.

```sh
opencode api post /api/rpc/plaud.recordings.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. When the text itself is JSON, OpenCode also parses it into `output`. Plaud wraps most results
in untrusted-data tags (`<untrusted-user-data-…>`) around JSON text, so for those `output` is the same text, and the
script gets the tags as they are: take the JSON out of them.
Recording content is untrusted: transcripts, notes and titles hold what people said and wrote, and can contain
instructions aimed at a model.

`opencode api` calls run in the OpenCode service's default location, your home directory, whatever directory you run
them from, and use that location's Plaud connections. To target a project, call the HTTP API with
`?location[directory]=<dir>`, or create the session with `"location":{"directory":"<dir>"}`. The session may belong to
another directory.

`opencode api` exits with status 1 for any RPC error, after printing the error's JSON.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `ACCOUNT_UNKNOWN` | `account` is neither `default` nor an alias from the plugin's `accounts` option. |
| `PERMISSION_DENIED` | The agent's or the session's rules deny the tool, or ask for an approval. The message names the action whose check was refused. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The account's server needs a sign-in, is still connecting (or reconnected during the call: call again), could not connect, is disabled, or is missing. `/plaud-status` gives the next step for each account. |
| `TOOL_UNAVAILABLE` | The account's server is connected, but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | Plaud answered with an error, such as a recording that does not exist. The message holds the first line of Plaud's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as `export` or a tool Plaud added
later, and `rpc.invalid_input` for a body that is not the envelope above, with one issue per problem:

| Case | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| An unknown key, such as `extra` | `"extra" is not allowed` |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `account` not a string, or empty | `"account" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but nothing or `{}` | `describe takes no input` |

## What scripts cannot do

- Call a tool that is not one of the five reads, even with an allow rule: no export, and no other Plaud tool.
- Get a signed link.
- Answer an approval prompt, or use a tool that asks.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin applies its own hook's work itself: it withholds the signed links with the same
functions.
