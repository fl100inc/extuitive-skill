# `/extuitive upload-status` — how is an upload going

Reports where an Extuitive upload has got to, and finishes by saying what was actually
accepted.

A `batchId` given with the command arrives in `$ARGUMENTS`.

## Why this is not just "did the transfer finish"

Bytes arriving at storage is not the same as a file being accepted. Every file is checked
after it lands, and it can still be rejected. `READY` is the only status that means a file
uploaded successfully, and it arrives some time after the transfer completes.

So "the upload finished" is never the answer on its own. The answer is how many reached
`READY`, and which ones did not, and why.

## Steps

### 1. Find the batch

In order of preference:

1. The `batchId` the person gave you, or the one from a `create_upload_batch` call earlier in
   this conversation.
2. Otherwise call `list_upload_batches` for the workspace. It returns batches newest first
   with `fileCount`, `pending`, `statusCounts`, `publishToMeta`, and where set `name`,
   `source` (`web`, `mcp`, `share_link`) and `shareLinkId` per batch. The first entry is the
   current one. This is also the right call when someone uploaded through a browser link,
   since you never saw a `batchId` for that. Filter with `source: "share_link"` or a
   `shareLinkId` to find the batch a one-time link produced; `collect.md` has that flow, and
   `get_upload_share_link` is usually the better read for one of those while it is live.

If you do not know which workspace, use the one chosen earlier in this conversation, or call
`list_workspaces` first when there was none. A `batchId` belongs to the workspace it was
created in, so a batch from before a switch needs the workspace it was made in rather than the
current one.

A single file uploaded on its own has no `batchId` at all. Use `get_upload_content` with its
`contentId` instead — same status rules apply.

For a question that spans batches — "which videos from last week are still not accepted",
"everything that came through that link" — `list_upload_content` filters the whole workspace
by `status`, `mediaKind`, `source`, `shareLinkId`, `batchId` and `metaPublishStatus`, paged
by `cursor`. Its counts describe the filtered page, not a batch, so it cannot tell you whether
a batch has settled; that stays with `get_upload_batch_content`.

### 2. Poll

Call `get_upload_batch_content` with the `batchId` about **every 5 seconds** until `settled`
is `true`.

Give up after about **5 minutes**. Say that you stopped waiting and what the counts were when
you did. Do not describe an unfinished batch as finished.

`list_upload_batches` is the cheaper call if you only need "is it done yet" across a whole
batch — it returns no file rows. Use `get_upload_batch_content` when you need to name
individual files.

### 3. Report periodically, not only at the end

This is the part that matters most, and it is the one that is easy to skip.

**While polling, tell the person where things stand roughly every 15–30 seconds.** Something
as short as "18 of 30 accepted, 12 still being checked" is enough. A silent two-minute wait is
indistinguishable from a hang, and the person cannot tell whether to keep waiting.

**When `settled` becomes `true`, report once more and stop polling.** That final report needs:

- how many reached `READY`, out of how many in the batch
- every `REJECTED` file by name, each with its `rejectionReason`
- anything left in a non-final state, if you stopped on the timeout rather than on `settled`

Then stop. Do not keep polling a settled batch.

Once a batch has settled, "what's in it" is a different job: `library.md` reads the accepted
files through the creative index. Do not answer that from filenames. "Is it in the ad
account" is different again: see below.

### Meta publish is a second lifecycle, not part of this one

Each row may also carry `metaPublishStatus` — `PENDING`, `PUBLISHING`, `PUBLISHED`, `FAILED`
— which tracks registering the accepted file with the Meta ad account. It is only present on
files that were queued for that, by `publishToMeta: true` when the batch was opened or by
`publish_upload_content_to_meta` later; on most batches it is absent on every row, and
absent means never queued, not failed.

`settled` and `pending` ignore it entirely. `metaPublishCounts` and `metaPublishPending` on
the response tally it for the whole batch. So an upload report says "30 of 30 accepted" when
`settled` is `true`, full stop; if the batch was set to publish, add a separate line — "12 of
30 registered with Meta so far" — and do not hold the upload report hostage to it.

On `PUBLISHED` the row carries `metaImageHash` (image) or `metaVideoId` and
`metaVideoThumbUrl` (video). On `FAILED` it carries `metaPublishError`. `publish.md` has the
table and what to do about a failure; `metaPublishStatus: ["PUBLISHED"]` as a filter finds the
rows that are done.

### 4. Read the numbers correctly

`statusCounts`, `pending`, `settled`, `metaPublishCounts` and `metaPublishPending` always
describe the **whole batch**. `count` describes only the rows the call returned.

That distinction bites when you filter. Asking for `status: ["READY"]` gives you just the
accepted rows, which is often what you want for a list — but `count` is then the number of
accepted files, not the batch size. The same goes for a `metaPublishStatus` or `mediaKind`
filter. Read progress from `statusCounts` and `pending`, never from `count`.

Only `READY`, `REJECTED`, and `ABORTED` are final. `VALIDATING` and `EXPIRED` are both still
counted in `pending`, so a batch is not settled while either remains.

| Status | Means | Final |
| --- | --- | --- |
| `CREATED` | Destination minted, bytes not sent yet | no |
| `UPLOADING` | Transfer in progress | no |
| `VALIDATING` | Landed, being checked | no |
| `READY` | Accepted. A `READY` image carries a short-lived `url` | yes |
| `REJECTED` | Refused — report `rejectionReason` | yes |
| `ABORTED` | Abandoned | yes |
| `EXPIRED` | Destination went unused; can still land | no |

## When a batch will never settle

A batch whose files sit at `CREATED` forever was opened by something that could not send the
bytes. That happens when `create_upload_batch` is called from a host with no way to make HTTP
requests. Say so plainly rather than polling for five minutes: the fix is
`create_browser_upload_link`, and the person uploads from their browser instead.

A file stuck at `UPLOADING` on a large video usually means its multipart upload was never
completed — `complete_upload` has to be called with the part ETags before the object is
assembled. `list_upload_parts` shows what storage actually holds.

## More detail

`tools.md` has every tool's arguments and the full error vocabulary.
