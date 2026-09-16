---
name: extuitive
description: Work with Extuitive, where each workspace is one Facebook ads account. Check that Extuitive is connected and signed in, choose which ad account to work in, upload images and videos in bulk, check how an upload is going and which files were accepted, read what uploaded files contain or find uploads like them, get files from a client or photographer through a one-time upload link, register uploaded files with the Meta ad account, build a Meta campaign, ad set, creative and ad or look up the ones that exist, connect or repair a Meta connection, or set Extuitive up from scratch. Use when asked to check the Extuitive connection or whether Extuitive is set up, to upload, add, or import creative, ad images, ad videos, or a folder of assets into Extuitive, to check an Extuitive upload, to say what is in an upload or what a video says, to find uploads that look like one another or match a description, to send someone an upload link or collect files from someone without an Extuitive login, to publish or push uploads to Meta or the ad account, to create or build a Meta campaign, ad set, ad creative or ad, to list campaigns, ad sets, ads, pages or pixels in the ad account, to pick or switch which Extuitive workspace or ad account to work in, or when Extuitive tools are missing or refusing.
argument-hint: "[init | select | upload | upload-status | library | collect | publish | build | connect]"
arguments: command
---

# Extuitive

One skill, nine jobs. Read the reference for the job you are doing and follow it; this page
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
| `library` | `references/library.md` | What does this file contain, which files are one ad at several sizes, find uploads like it or about it |
| `collect` | `references/collect.md` | Get files from someone with no Extuitive login — a one-time upload link, optionally emailed |
| `publish` | `references/publish.md` | Register accepted uploads with the Meta ad account, so they have an image hash or video id |
| `build` | `references/build.md` | Create a campaign, ad set, creative and ad in the ad account; copy one that exists; list campaigns, ad sets, ads, pages, pixels |
| `connect` | `references/connect.md` | No workspaces, or ads data has gone stale — the *Meta* connection |

Anything else, or nothing at all: pick from the "For" column. An unrecognised command is
worth one sentence — say what the nine are — rather than a guess.

"Connection" is ambiguous here, so route it by what is being asked about. Whether *this
host* can reach Extuitive — tools present, signed in, workspaces listed — is `init`, which
checks all three in order and hands off to `connect` itself if the only thing missing is a
Meta connection. Whether a *workspace's* ads data is flowing is `connect`.

"Upload" is ambiguous too. Files on a disk you can read, or with the person you are talking
to, are `upload`. Files with someone else who has no Extuitive login are `collect`. Putting
already-uploaded files *into the ad account* is `publish`, and it is never implied by either.

`references/tools.md` documents every tool's arguments, the error vocabulary, and the three
lifecycles — upload status, Meta publish, and Meta action. Reach for it when a call fails or
a field is not what you expected.

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
request for thirty ads. Report what landed and wait. Reading them with `library` is the same:
describing an upload is not a proposal to run it. And nothing reaches the ad account on its
own — Meta is opt-in, through `publish`, and only when they ask.

**Some calls need a yes first.** Publishing files to Meta, emailing a one-time link, revoking
one, aborting a multipart upload, and each of the four `create_meta_*` calls all change
something the person owns. Say what is about to happen and wait for them, every time. No tool
in this surface is marked destructive; you have to know.

**Nothing built here ever runs.** Every campaign, ad set and ad is created `PAUSED`, the
server enforces it, and `ACTIVE` is refused. Say so whenever you create one. The person turns
it on in Ads Manager; you cannot, and should not offer to.

**Say what a tool returned, not what it implies.** The fields on a workspace do not predict
which tools will accept it — `role` and `isOwner` govern the owner-only tools (reconnecting
Meta, one-time links) and nothing else — so "use this one for uploads" is a claim you can only
make after one worked. Two workspaces can point at the same ad account and behave
differently. Ask rather than choose.

**Ask which workspace once, then stop asking.** A choice made anywhere in the conversation —
through `select`, or in passing while asking for something else — holds until they change it
or the session ends. Re-asking on every upload is its own kind of wrong answer.
