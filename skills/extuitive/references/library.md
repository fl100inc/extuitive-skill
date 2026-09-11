# `/extuitive library` — what is in the files that were uploaded

Reads a workspace's bulk-uploaded files through the creative index: what each image shows,
what each video says, which files are one ad exported at several sizes, and which uploads look
like, or are about, a given thing.

A `batchId` or one or more `contentId`s given with the command arrive in `$ARGUMENTS`.

## What this job is and is not

The upload tools tell you a file's name, size, kind and whether it was accepted. They do not
tell you what is in it. After an upload settles, every accepted file is read by the creative
index: images get their on-screen text, visual tags and a description; videos get those plus
duration, a transcript, the opening line, and whether the audio is speech or music. This job
reads that back.

It covers **only files that arrived through an upload on this workspace**. Not the ads Meta is
running, not another workspace, not performance. Every tool here forces that scope and no
argument widens it. If someone asks "how is this doing" or "what's live", say that this reads
uploads only and stop.

**Describing files is not a proposal to run them.** Someone who asks what is in an upload wants
to hear what is in the upload. Say it, and wait.

## The four tools

| Tool | Answers | Takes |
| --- | --- | --- |
| `describe_content` | What is in these files | `contentIds[]`, optional `fields` |
| `group_content_variants` | Which files are the same ad at 1:1 / 4:5 / 9:16 | `batchId` |
| `find_similar_content` | Have we uploaded something like this | `contentId`, optional `k`, `vectorKind`, `batchId` |
| `search_content` | Uploads matching a description, tags, type or time window | any of `text`, `hookText`, `tags`, `mediaType`, `uploadedSince`, `batchId` |

All four take `workspaceId`. All are read-only. `tools.md` has every argument and field.

Every id is the `contentId` the upload minted. The person says "the hero shot"; you have
`hero_1x1.png` on disk; the batch manifest maps that filename to a `contentId`; the index
takes the `contentId`. Keep that mapping in hand for the whole conversation. When you never
saw the upload — someone uploaded from their browser, or in an earlier session — get it from
`get_upload_batch_content`, which returns `fileName` next to `contentId`.

## Steps

### 1. Find the files

In order of preference:

1. The `contentId`s or `batchId` you were given, or the ones from an upload earlier in this
   conversation.
2. Otherwise `list_upload_batches`, newest first, then `get_upload_batch_content` with
   `status: ["READY"]` for the rows. Only `READY` files are ever indexed; a `REJECTED` file has
   nothing to describe.

Use the workspace chosen earlier in the conversation. A `batchId` belongs to the workspace it
was created in.

### 2. Describe

Call `describe_content` with every `READY` `contentId` from the batch, up to 50 per call. Page
past that; do not drop ids.

Each id comes back in one of three states. Say a different thing for each:

| State | Means | Say |
| --- | --- | --- |
| `indexed`, `annotated: true` | The index has read and described it; `asset` holds the fields | What it shows or says, in the index's words |
| `indexed`, `annotated: false` | The file is known and measured (type, duration, size) but the description pass has not finished; no tags, prose or transcript yet | "Known, still being described." For video this window is under a minute after `indexed` |
| `not_indexed_yet` | It is this workspace's file (`uploadStatus` is there) but the index has not caught up | "Still being read." Images take about a minute after `READY`; video a minute or two |
| `unknown` | Not an upload in this workspace | "No such upload here." Check the id and the workspace |

`not_indexed_yet` is the **normal first answer on a fresh upload**, especially for video. It is
not an error and not a reason to poll. Report what is indexed, name what is not, tell the
person video takes a minute or two, and offer to look again when they ask. If you must check
again unprompted, once after a few minutes is the limit.

`annotated: false` is the step after that: the document exists, so `duration_seconds` and
`media_type` are real, but `holistic_description`, `visual_tags`, `audio_type` and the
transcript fields are simply absent. Absent is not "silent", "no on-screen text" or "no tags".
`awaitingAnnotation` at the top of the response counts these. Treat them like
`not_indexed_yet` for everything but the duration. Measured on dev: four of five images were
described the moment they were indexed, the fifth 65 seconds later, an 8-second video 16
seconds later. A file still `annotated: false` well past that (say ten minutes) is not
"still being described" — the description pass did not run for it. Say that plainly and
move on; the person can raise it with whoever runs the index.

A `not_indexed_yet` row whose `uploadStatus` is `REJECTED`, `ABORTED` or `EXPIRED` will never
be indexed. Say that instead of "still being read".

Do not fill a `not_indexed_yet` gap from the filename. `talking_head_v2.mp4` tells you what
someone hoped the file was, not what is in it.

### 3. Group

If the batch has more than a handful of images, call `group_content_variants` with the
`batchId` before summarizing. Exports commonly arrive as the same ad at 1:1, 4:5 and 9:16, and
"six images" is the wrong count when it is two ads at three sizes each.

Each group has an `anchor` (the 1:1 when there is one), its `members` with their aspect
bucket, and a `group_id`. Summarize per group, naming the sizes present. A group never mixes
a still with a video; a clip that opens on the frame a static was cut from is a different
creative and gets its own group.

A file alone in its group is a lone concept **unless** it is counted in
`ungroupedNoDimensions` or listed in `notEmbedded`, which means it is still waiting on the
index and could yet join a group. On a batch uploaded in the last few minutes those two
lists mean "not yet", not "never": the index's asset record trails its searchable vector by
about a minute, so grouping straight after everything reads `annotated: true` under-counts.
Wait a minute and call it once more before summarizing, or say the count is provisional.

### 4. Summarize, in the index's words

One line per ad, not per file. For an image: what the tags and description say is in it, and
the on-screen text if any. For a video: duration, what it opens on (`transcript_hook`,
`hook_on_screen_text`), `audio_type`, and whether it has speech.

Something like:

> Six files, two ads. **Ad A** (1:1, 4:5, 9:16): face oil bottle on linen with flowers,
> overlay "SOOTHE. NOURISH. RENEW." **Ad B** (1:1, 9:16): the same bottle on a nightstand,
> overlay "my whole nighttime routine, honestly". **Video 1**, 19s, speech: opens on "I
> stopped buying face oil until…", talking head. **Video 2** still being read; it was accepted
> four minutes ago and video takes a few minutes.

Relay the fields; do not grade them. "Strong hook" and "on-brand" are judgments the index does
not make and neither should you. Then stop.

### 5. Answer the follow-ups with the other two tools

**"Have we uploaded something like this?"** — `find_similar_content` with the `contentId`.
Neighbors come back nearest first with a `score`, a `fileName` and `aspectBucket` to call
them by, and their fields; the query itself is left out. Expect its own aspect-ratio
siblings at the top; the interesting results are after them. `vectorKind: "hook"` compares
how videos *open* rather than the whole clip. If the query's vector is not searchable yet you
get `content_not_indexed_yet` — on a fresh upload that can happen for a minute after
`describe_content` first says `indexed`, and for a video until it has been described.
Report it as "give it a minute" and do not retry in a loop.

**"Find the videos with the price on screen."**, **"The ones with the product on white."**,
**"What did we upload last week?"** — `search_content`. `text` searches overlay copy,
descriptions and transcripts; `hookText` searches the opening seconds of videos only; `tags`
match the index's own vocabulary; `uploadedSince` takes `now-7d` style date math. Without
`text` the results are newest first; with it each hit carries a `score`. Each hit has the same
describe set as `describe_content` plus `file_names` and `annotated`; pass `fields` to get
less (`["media_type", "file_names"]` to list) or more (`transcript`). `topTags` in the
response is how you learn the words the index uses for this account — read it before
guessing a tag. Tags come back in lower case and match regardless of case, so a tag read off
`topTags` can go straight back in as `tags`.

Both search this workspace's uploads only. Say so if the question was about anything else.

## What can go wrong

| You see | It means | Do |
| --- | --- | --- |
| `not_indexed_yet` for every file right after upload | Normal; the index runs after `READY` | Report, name them, offer to look again later |
| `indexed` but `annotated: false`, no tags or prose | Known, description still running | Say "still being described"; do not read the absence as silence or blank |
| `annotated: false` ten minutes on | The description pass did not run for this file | Say so; it is not going to describe itself |
| `not_indexed_yet` with `uploadStatus: REJECTED` | Will never be indexed | Say so; `get_upload_batch_content` has the `rejectionReason` |
| `unknown` for an id you got from a batch | Wrong workspace, or the id was mis-copied | Check which workspace the batch was created in |
| `content_not_indexed_yet` from `find_similar_content` | The query's vector is not searchable yet, even if describe says `indexed` | Give it a minute; same rule as `not_indexed_yet` |
| `notEmbedded` or `ungroupedNoDimensions` on a batch uploaded minutes ago | The asset record is trailing the vector | Wait a minute, group once more, or call the count provisional |
| `workspace_has_no_ad_account` | The workspace has no Meta account connected, so no library | `connect` |
| `library_unconfigured` | The server is not wired to the index in this environment | Say so; nothing you can do from here |
| `library_upstream_error` with a `message` | The index refused the query; the message says why | Read it — usually a bad `fields` name or too many ids |
| `workspace_access_denied` | Not a member of that workspace | Same rule as everywhere: name the refused id, use one that works |

## More detail

`tools.md` has every argument, the default `fields` set, and the full error vocabulary.
