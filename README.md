# extuitive-skill

An agent skill for [Extuitive](https://go.extuitive.com), plus an installer that connects
Claude Code or Codex CLI to the Extuitive MCP server.

An Extuitive workspace is one Facebook ads account. The skill lets an agent upload creative
into a workspace, track how that upload is going, and repair a Meta connection that has
stopped delivering data.

Installed straight from this repository — there is no npm package:

```bash
npx github:fl100inc/extuitive-skill install
```

That copies the skill into your host's skills directory, registers the MCP server, and tells
you how to sign in. Signing in happens in your browser; the installer never handles your
credentials.

**You do not need an Extuitive account first.** The sign-in page has a **Sign up** button
next to **Log in**, both using a one-time email code, so you can create the account in the
same browser step that grants your host access. If you have not connected Meta yet, that page
then points you at the right setup step and brings you back.

## What gets installed

One skill, `extuitive`, which takes a command:

| Command | What it does |
| --- | --- |
| `/extuitive init` | Set up from scratch: connect, sign in, confirm it works |
| `/extuitive upload` | Upload a folder of images or videos into a workspace |
| `/extuitive upload-status` | Report how the current upload is going |
| `/extuitive connect` | Connect Meta, or repair a workspace that has stopped updating |

Arguments go after the command: `/extuitive upload ./creative` or
`/extuitive upload-status <batch id>`.

That is the Claude Code syntax. Codex uses `$extuitive` and browses with `/skills`. Both hosts
take a skill's name from its directory, which is why there is one skill with commands rather
than four skills — `/extuitive-upload` would be a separate directory each time, and the
command form reads better and keeps one description in front of the model.

You usually will not type any of it. Asking for the underlying thing — "upload these ads to
Extuitive" — reaches the skill on its own.

## Install

### Claude Code

```bash
npx github:fl100inc/extuitive-skill install --host claude
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
npx github:fl100inc/extuitive-skill install --host codex --write-config
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
  `skills/extuitive/scripts/upload.mjs` to do the transfer, then reports the outcome through
  the tools.
- **A host that cannot** uses `create_browser_upload_link` and hands the person a link to
  upload from their browser.

It also means a finished transfer is not an accepted file. Bytes landing in storage starts a
check that can still reject the file, so `READY` — not "upload complete" — is the only status
that means success. The upload and status flows are built around reporting that honestly.

The bundled script holds no credential and makes no MCP calls. It receives presigned URLs,
sends bytes, and reports ETags. Your access token stays in your host's credential store.

## Tools

Fourteen tools in three groups. Full schemas, the error vocabulary, and the status lifecycle
are in
[`skills/extuitive/references/tools.md`](skills/extuitive/references/tools.md).

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
npx github:fl100inc/extuitive-skill doctor
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
npx github:fl100inc/extuitive-skill install --endpoint http://localhost:3001/mcp
```

Port 3001 is what the lead-magnet app binds with `npm run dev`.

## Uninstall

```bash
npx github:fl100inc/extuitive-skill uninstall
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
bin/cli.mjs                 install | uninstall | doctor
src/                        host detection, install, MCP setup, doctor
skills/extuitive/
  SKILL.md                  routes a command to its reference
  references/               one file per command, plus the full tool reference
  scripts/upload.mjs        byte transfer only; no credentials, no MCP calls
```

`SKILL.md` stays short on purpose: it is loaded whenever the skill is considered, while a
`references/` file is read only once the agent knows which job it is doing. Putting all four
flows in the front page would spend context on three of them every time.

`README.md` lives here at the repo root and nowhere else. Skill directories deliberately do
not contain one — everything an agent reads belongs in `SKILL.md` or `references/`, and a
`README.md` inside a skill folder is dead weight in its context window.

Host-specific setup commands live only in `src/mcp-setup.mjs`. The skill never names them; it
tells the agent to run `doctor` and relay what it prints, so a change to either host's CLI is
a fix in one file rather than four.

## Licence

MIT
