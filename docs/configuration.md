# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. Reads run at every level; the export runs at all, asks at ask-changes and is refused at read-only. |
| `accounts` | object | — | One profile per account alias. Each alias signs in to its own Plaud MCP server, named plaud for default and plaud-<alias> otherwise. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range instead of refusing with HOST_UNTESTED. |
| `url` | string | `"https://mcp.plaud.ai/mcp"` | The Plaud MCP endpoint every account's server uses. Change it only to reach Plaud through a proxy you run; plain http is accepted only on localhost. |
| `exportRoots` | array | `["~/Plaud"]` | The folders an export may write in, absolute or starting with ~/. The first holds the default destination. A destination outside every root is refused. |
| `maxAudioBytes` | integer | `2147483648` | The largest audio file one export downloads, in bytes, up to 64 GiB. The default is 2 GiB. |
| `exportTimeoutMs` | integer | `1800000` | How long one export may take, in milliseconds, from 1 second to 24 hours. The default is 30 minutes. |
<!-- /generated:configuration -->

## Two accounts

```json
{
  "access": "ask-changes",
  "accounts": {
    "default": {},
    "work": {}
  },
  "exportRoots": ["~/Plaud", "/Volumes/Archive/Plaud"],
  "maxAudioBytes": 2147483648,
  "exportTimeoutMs": 1800000
}
```

- `access` is the ceiling. `all` runs every method; `ask-changes` asks before the export; `read-only` refuses it.
  Every read runs at every level. A person's answer for one tool, or a rule added later, still wins.
- `accounts` is one profile per alias. A Plaud profile has no fields: the sign-in lives on the alias's MCP server.
  With no `accounts` option there is one `default` account on the `plaud` server.
- `url` is the one Plaud MCP endpoint every server uses. Change it only to reach Plaud through a proxy you run; plain
  `http` is accepted only on localhost.
- `exportRoots` are the folders an export may write in; the first holds the default destination. A destination outside
  every root is refused.
- `maxAudioBytes` caps one audio download; `exportTimeoutMs` caps the whole export, counted from the commit.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: an untested host gets
  `HOST_UNTESTED` and a next step.

## The export's default destination

`<first export root>/<kind>/<recordingId>.<ext>`:

| Kind | Default file |
|---|---|
| `audio` | `<root>/audio/<recordingId>.mp3` |
| `transcript` | `<root>/transcript/<recordingId>.<block>.md` |
| `note` | `<root>/note/<recordingId>.md` |

Pass an absolute `destination` to choose another file inside a root, and `overwrite: true` to replace one that exists.
