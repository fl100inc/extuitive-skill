# extuitive-skill

Agent skills for [Extuitive](https://go.extuitive.com), plus an installer that connects
Claude Code or Codex CLI to the Extuitive MCP server.

An Extuitive workspace is one Facebook ads account. These skills let an agent upload creative
into a workspace, track how that upload is going, and repair a Meta connection that has
stopped delivering data.

```bash
npx extuitive-skill install
```

That copies four skills into your host's skills directory, registers the MCP server, and tells
you how to sign in. Signing in happens in your browser — the installer never handles your
credentials.

New to Extuitive? Create an account at **https://go.extuitive.com** first.

## What gets installed

| Skill | Invoke as | What it does |
| --- | --- | --- |
| `extuitive-init` | `/extuitive-init` | Set up from scratch: account, connection, sign-in |
| `extuitive-upload` | `/extuitive-upload` | Upload a folder of images or videos into a workspace |
| `extuitive-upload-status` | `/extuitive-upload-status` | Report how the current upload is going |
| `extuitive-workspace-setup` | `/extuitive-workspace-setup` | Diagnose and repair a Meta connection |

Those are the Claude Code names. Codex uses `$extuitive-upload` and browses with `/skills`.
Both hosts take a skill's name from its directory, so the names are the same on each.

Except for `extuitive-init`, all of them are also invoked automatically when what you ask for
matches — "upload these ads to Extuitive" reaches `extuitive-upload` without you naming it.
`extuitive-init` only runs when you ask, since setup is not something to start mid-task.

## Install

### Claude Code

```bash
npx extuitive-skill install --host claude
```

Which does:

```bash
# skills → ~/.claude/skills/
claude mcp add --transport http extuitive https://app.extuitive.com/mcp --scope user
```

Then sign in — run `/mcp` inside Claude Code, choose `extuitive`, and approve. Or
`claude mcp login extuitive`.

`--scope user` matters. The default is `local`, which ties the server to whichever directory
you ran the command in, while your skills are available everywhere. That combination works in
one project and looks broken in the next.

### Codex CLI

```bash
npx extuitive-skill install --host codex --write-config
```

Which does:

```toml
# ~/.codex/config.toml — skills are behind an experimental flag
[features]
skills = true
```

```bash
# skills → ~/.agents/skills/
codex mcp add extuitive --url https://app.extuitive.com/mcp
```

Then `codex mcp login extuitive` to sign in, and **restart Codex** — it reads skills once at
startup, so new ones are invisible until you do.

`--write-config` is what permits editing `~/.codex/config.toml`. Without it you are shown the
two lines to add yourself. Either way the file is backed up before it is touched.

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host <claude\|codex\|both>` | detected | Which host to set up. Required without a TTY. |
| `--scope <user\|project>` | `user` | Every project, or only this one. |
| `--dir <path>` | host default | Install skills somewhere else entirely. |
| `--endpoint <url>` | `https://app.extuitive.com/mcp` | Point at a different server. |
| `--write-config` | off | Allow editing the host's config file. |
| `--dry-run` | off | Report what would change, change nothing. |
| `--yes`, `-y` | off | Take defaults, never prompt. |

No client id, secret, or API key anywhere. The server supports Dynamic Client Registration, so
both hosts negotiate their own credentials from the URL alone.

## How uploading works

Worth reading before the tool list, because it explains the shape of everything else.

**The MCP tools never carry file bytes.** `create_upload_batch` returns presigned storage URLs
and whoever holds the files sends the bytes to those URLs directly. No tool accepts a file.

That single fact splits the behaviour in two:

- **A host that can run shell commands** — Claude Code, Codex — uses the script bundled in
  `extuitive-upload/scripts/upload.mjs` to do the transfer, then reports the outcome through
  the tools.
- **A host that cannot** uses `create_browser_upload_link` and hands the person a link to
  upload from their browser.

It also means a finished transfer is not an accepted file. Bytes landing in storage starts a
check that can still reject the file, so `READY` — not "upload complete" — is the only status
that means success. Both upload skills are built around reporting that honestly.

The bundled script holds no credential and makes no MCP calls. It receives presigned URLs,
sends bytes, and reports ETags. Your access token stays in your host's credential store.

## Tools

Fourteen tools in three groups. Full schemas, the error vocabulary, and the status lifecycle
are in
[`skills/extuitive-upload/references/tools.md`](skills/extuitive-upload/references/tools.md).

**Workspaces**

- `list_workspaces` — every workspace you can reach, with the health of its Meta connection.

**Meta connection**

- `get_meta_setup_status` — why you have no workspaces, and the link that fixes it.
- `create_meta_reconnect_link` *(workspaceId)* — repair a workspace's Meta connection. Owner only.

**Uploads**

- `get_upload_limits` *(workspaceId)* — server-owned ceilings. Never hardcode them.
- `create_upload_batch` *(workspaceId, files)* — open a batch, get a destination per file.
- `resign_upload` *(workspaceId, contentId)* — a fresh URL when one expires.
- `sign_upload_part` *(workspaceId, uploadId, partNumber)* — presign one chunk of a large video.
- `list_upload_parts` *(workspaceId, uploadId)* — what storage already holds, for resuming.
- `complete_upload` *(workspaceId, uploadId, parts)* — assemble a multipart upload.
- `abort_upload` *(workspaceId, uploadId)* — abandon one.
- `list_upload_batches` *(workspaceId)* — batch history, newest first. The cheap progress check.
- `get_upload_batch_content` *(workspaceId, batchId)* — per-file rows and status for one batch.
- `get_upload_content` *(workspaceId, contentId)* — one file.
- `create_browser_upload_link` *(workspaceId)* — hand the transfer back to the browser.

## The MCP server

- **Endpoint** `https://app.extuitive.com/mcp`
- **Transport** stateless Streamable HTTP JSON-RPC over `POST`
- **Auth** OAuth 2.1, authorization code with PKCE `S256`, Dynamic Client Registration, scope `mcp`

Workspace membership is verified on every workspace-scoped call rather than once at sign-in,
so leaving a workspace takes effect immediately.

This package stores no credential of any kind. Your host holds the OAuth token; the upload
script only ever sees presigned URLs scoped to a single object, which expire.

## Troubleshooting

```bash
npx extuitive-skill doctor
```

It reports the endpoint, which skills are installed where, and what your host says about the
server — including the difference between "not registered" and "registered but not signed in",
which is not visible from the outside. Add `--json` for machine-readable output.

Common causes, in the order they usually happen:

- **Skills do not appear.** On Codex, either `[features] skills = true` is missing from
  `~/.codex/config.toml` or you have not restarted since installing. On both hosts, a skill
  whose frontmatter `name` differs from its directory name silently fails to load; `doctor`
  checks this.
- **A stale duplicate.** Codex still scans the legacy `~/.codex/skills` alongside
  `~/.agents/skills`, so an old copy can shadow a new one. `doctor` names any it finds.
- **Tools are listed but every call is refused.** Sign-in was never completed. Run `/mcp` in
  Claude Code or `codex mcp login extuitive`.
- **A `403` part-way through an upload.** Presigned URLs last 30 minutes and a whole batch is
  signed at once, so late files in a big batch can expire mid-transfer. The script reports
  these as `needsResign` and `needsPartResign`; the fix is `resign_upload` or
  `sign_upload_part` and a re-run for just those files.
- **A batch stuck at `CREATED`.** It was opened by a host that could not send the bytes. Use
  `create_browser_upload_link` instead.

## Local development

```bash
npx extuitive-skill install --endpoint http://localhost:3001/mcp
```

Port 3001 is what the lead-magnet app binds with `npm run dev`.

## Uninstall

```bash
npx extuitive-skill uninstall
```

Removes the skill directories. It leaves two things alone deliberately: anything under
`~/.extuitive-skill/backups/`, which exists because an install found a skill that differed
from the one it was about to write, and the MCP registration plus your stored sign-in, which
belong to your host. Remove that yourself with `claude mcp remove extuitive` or
`codex mcp remove extuitive`.

Backups live outside the skills directories on purpose. Both hosts treat every directory in
their skills root as a skill, and Codex searches it recursively, so a backup kept next to the
skill it replaced would be loaded as a second, older copy of that skill.

## Repository layout

```
bin/cli.mjs     install | uninstall | doctor
src/            host detection, install, MCP setup, doctor
skills/         the four skills, copied verbatim into your host
```

`README.md` lives here at the repo root and nowhere else. Skill directories deliberately do
not contain one — everything an agent reads belongs in `SKILL.md` or `references/`, and a
`README.md` inside a skill folder is dead weight in its context window.

Host-specific setup commands live only in `src/mcp-setup.mjs`. The skills never name them;
they tell the agent to run `npx extuitive-skill doctor` and relay what it prints, so a change
to either host's CLI is a fix in one file rather than four.

## Licence

MIT
