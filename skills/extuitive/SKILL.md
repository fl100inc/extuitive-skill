---
name: extuitive
description: Work with Extuitive, where each workspace is one Facebook ads account. Check that Extuitive is connected and signed in, choose which ad account to work in, upload images and videos in bulk, check how an upload is going and which files were accepted, connect or repair a Meta connection, or set Extuitive up from scratch. Use when asked to check the Extuitive connection or whether Extuitive is set up, to upload, add, or import creative, ad images, ad videos, or a folder of assets into Extuitive, to check an Extuitive upload, to pick or switch which Extuitive workspace or ad account to work in, or when Extuitive tools are missing or refusing.
argument-hint: "[init | select | upload | upload-status | connect]"
arguments: command
---

# Extuitive

One skill, five jobs. Read the reference for the job you are doing and follow it; this page
only routes.

## Which job

The requested command is **`$command`**, from the full invocation `$ARGUMENTS`.

If that is empty, or still reads as a literal `$command` because this host does not
substitute arguments, work it out from what was actually asked instead.

| Command | Read | For |
| --- | --- | --- |
| `init` | `references/init.md` | Nothing is set up yet, the tools are missing, or "check my Extuitive connection" — is it set up, signed in, and working |
| `select` | `references/select.md` | Choose which ad account the rest of this session works in |
| `upload` | `references/upload.md` | Send local files into a workspace |
| `upload-status` | `references/upload-status.md` | How is an upload going, what was accepted |
| `connect` | `references/connect.md` | No workspaces, or ads data has gone stale — the *Meta* connection |

Anything else, or nothing at all: pick from the "For" column. An unrecognised command is
worth one sentence — say what the five are — rather than a guess.

"Connection" is ambiguous here, so route it by what is being asked about. Whether *this
host* can reach Extuitive — tools present, signed in, workspaces listed — is `init`, which
checks all three in order and hands off to `connect` itself if the only thing missing is a
Meta connection. Whether a *workspace's* ads data is flowing is `connect`.

`references/tools.md` documents every tool's arguments, the error vocabulary, and the status
lifecycle. Reach for it when a call fails or a field is not what you expected.

## True regardless of which job

**The MCP tools never carry file bytes.** `create_upload_batch` hands back presigned storage
URLs and whoever holds the files sends the bytes there directly. No tool accepts a file. If
you cannot open the person's files, you cannot upload — use `create_browser_upload_link` and
let them do it from their browser. Being able to run code is not the same as being able to
read their disk; some hosts give you one without the other.

**Signing in happens in a browser and only the person can do it.** The token lands in this
host's own credential store. You never see it, and no amount of retrying substitutes for it.

**If the Extuitive tools are not in this session, stop and read `references/init.md`.** Do not
invent setup commands. They differ per host and they change.

**Uploading files is not an instruction to do anything with them.** Thirty images is not a
request for thirty ads. Report what landed and wait.

**Say what a tool returned, not what it implies.** The fields on a workspace do not predict
which tools will accept it — `role` and `isOwner` govern reconnecting Meta and nothing else —
so "use this one for uploads" is a claim you can only make after one worked. Two workspaces
can point at the same ad account and behave differently. Ask rather than choose.

**Ask which workspace once, then stop asking.** A choice made anywhere in the conversation —
through `select`, or in passing while asking for something else — holds until they change it
or the session ends. Re-asking on every upload is its own kind of wrong answer.
