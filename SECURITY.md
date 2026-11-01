# Security

## Supported versions

Only the latest version gets security fixes. It supports OpenCode `>=2.2.3 <2.3.0` and is tested on 2.2.3 and 2.2.4.

## Reporting a vulnerability

Report a security problem privately, through GitHub private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the plugin version, the OpenCode version, what you did and what happened. Never include a token, a signed link or the content of a recording.

## Data handling

Recordings, transcripts and notes are often highly sensitive. The plugin:

- never sees your Plaud sign-in. OpenCode's MCP OAuth signs you in, and OpenCode stores and refreshes the tokens in its own credential store. The plugin has no option for a token and never reads, logs or stores one;
- makes one kind of network request of its own: an export's audio download, from the signed audio link Plaud returns. OpenCode's MCP client makes every other request to Plaud's server;
- writes files only for `plaud_export`, only inside your export roots, as private files (0600) in private folders (0700) that it creates. It refuses a destination outside the roots, including through a symbolic link, and replaces a file only with `overwrite: true`;
- stores nothing else and collects no telemetry.

What the model reads, such as a transcript, goes to your model provider like any other tool result.

### Signed links

Plaud's results carry signed links. Anyone who has one can download what it points to until it expires:

- `presigned_url` in `get_file`: the recording's audio, for about 24 hours;
- `data_link` in `get_file` (each item of `source_list` and `note_list`) and in `get_note` (each tab): the transcript or note content.

The plugin replaces every one of them in every Plaud tool result before the model, the session history or your model provider see it. There is no option to turn this off. The model never needs a link: `plaud_export` reads the results itself, fetches the audio link plugin-side, and never returns or logs a link.

The hook covers results on OpenCode's own tool path, for direct and Code Mode calls, and rewrites the links inside the untrusted-data tags around Plaud's results. Another plugin that runs Plaud tools through raw executors from `ctx.tool.list()` skips host hooks, so it receives the links.

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
