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
   with `fileCount`, `pending`, and `statusCounts` per batch. The first entry is the current
   one. This is also the right call when someone uploaded through a browser link, since you
   never saw a `batchId` for that.

If you do not know which workspace, use the one chosen earlier in this conversation, or call
`list_workspaces` first when there was none. A `batchId` belongs to the workspace it was
created in, so a batch from before a switch needs the workspace it was made in rather than the
current one.

A single file uploaded on its own has no `batchId` at all. Use `get_upload_content` with its
`contentId` instead — same status rules apply.

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

### 4. Read the numbers correctly

`statusCounts`, `pending`, and `settled` always describe the **whole batch**. `count`
describes only the rows the call returned.

That distinction bites when you filter. Asking for `status: ["READY"]` gives you just the
accepted rows, which is often what you want for a list — but `count` is then the number of
accepted files, not the batch size. Read progress from `statusCounts` and `pending`, never
from `count`.

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
