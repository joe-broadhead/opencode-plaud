# Security

## Supported versions

Only the latest version gets security fixes. It supports OpenCode `>=2.2.3 <2.3.0` and is tested on 2.2.3, 2.2.4 and 2.2.5.

## Reporting a vulnerability

Report a security problem privately, through GitHub private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the plugin version, the OpenCode version, what you did and what happened. Never include a token, a signed link or the content of a recording.

## Data handling

Recordings, transcripts and notes are often highly sensitive. The plugin:

- never sees your Plaud sign-in. OpenCode's MCP OAuth signs you in, and OpenCode stores and refreshes the tokens in its own credential store. The plugin has no option for a token and never reads, logs or stores one;
- makes one kind of network request of its own: an export's audio download, from the signed audio link Plaud returns. The link and every redirect it follows must be https, with no user name or password in them. OpenCode's MCP client makes every other request to Plaud's server;
- writes files only for `plaud_export`, only inside your export roots, as private files (0600) in private folders (0700) that it creates. It refuses a destination outside the roots, including through a symbolic link, and replaces a file only with `overwrite: true`;
- stores nothing else and collects no telemetry.

What the model reads, such as a transcript, goes to your model provider like any other tool result.

### Signed links

Plaud's results carry signed links. Anyone who has one can download what it points to until it expires:

- `presigned_url` in `get_file`: the recording's audio, for about 24 hours;
- `data_link` in `get_file` (each item of `source_list` and `note_list`) and in `get_note` (each tab): the transcript or note content.

The plugin replaces every one of them in every Plaud tool result before the model, the session history or your model provider see it. There is no option to turn this off. The model never needs a link: `plaud_export` reads the results itself, fetches the audio link plugin-side, and never returns or logs a link.

The hook covers results on OpenCode's own tool path, for direct and Code Mode calls, and rewrites the links inside the untrusted-data tags around Plaud's results. The plugin's tools RPC for scripts skips host hooks, so it withholds the links itself, with the same functions. Another plugin that runs Plaud tools through raw executors from `ctx.tool.list()` skips host hooks, so it receives the links.

### Recordings are not trusted

Recording names, transcripts and notes are content from your recordings, and anyone who spoke near the recorder could have put text in them. They can contain instructions written to mislead the model.

- Plaud's server returns each result inside untrusted-data tags (`<untrusted-user-data-…>`). The plugin passes the results to the model unchanged, tags included, apart from the signed links. It does not filter them.
- The skills tell the model to treat this content as data, never as instructions, and not to export, switch accounts or send anything because of it.
- Keep the prompts for exports and other side effects while you work with recordings.

## Permissions

- The plugin adds default rules to each agent: Plaud's five read tools, including `get_current_user` (your own account details), run without a prompt, and exports and every other Plaud tool ask. See [Configuration](docs/configuration.md#permissions).
- **A saved "Always allow" applies to the whole project and to every agent in it, Plan included.** OpenCode saves the approval for the project, not for the agent or the session. A `deny` rule in your config still wins over it.
- **OpenCode decides which folders form one project.** On OpenCode 2.2.3, a folder with no git commit, such as a new git repository, can belong to OpenCode's shared `global` project. An approval saved there then applies in every other folder of that project. Do not count on a saved approval staying in one folder. For exports you want unattended, prefer an `allow` rule in that project's `opencode.json`, narrowed to the account and kind.
- Agents that you define only in your config do not get the default rules, so exports and other Plaud tools run there without a prompt. `/plaud-status` names these agents and gives the fix.
- The rule pattern `plaud*_*`, and the signed-link hook, also match the tools of any other MCP server whose name starts with `plaud`.

## Scripts

The tools RPC (`plaud.recordings.tools`, see [docs/scripting.md](https://github.com/joe-broadhead/opencode-plaud/blob/HEAD/docs/scripting.md)) runs Plaud's five read tools for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. A tool that the agent's or the session's rules hide from the model is refused. OpenCode's own executor then checks the call against the agent's rules, the session's rules and saved approvals, as it does for the model.
- An ask on a script's call is denied, not prompted: no one is there to answer it. The plugin's permission hook changes only an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Only the five known reads are methods. `plaud_export`, `plaud_recent` and any other Plaud tool, including one Plaud adds later, never are, even with an allow rule. A script writes no file.
- A script never gets a signed link: the plugin withholds every `presigned_url` and `data_link` in the result, as the hook does for the model.
- `account` picks an account from the plugin's `accounts` option; any other value is refused. A server your config defines under an account's name is used, as for the model.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Recording content in a result is untrusted, as it is for the model.
- Plaud's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The session is not a login: it scopes a script to what its agent may do.
