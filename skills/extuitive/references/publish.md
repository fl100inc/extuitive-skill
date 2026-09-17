# `/extuitive publish` — register uploaded files with the Meta ad account

Takes files that are already in an Extuitive workspace and registers them with the
workspace's Meta ad account, so each one gets the handle an ad is built from: an image hash
or a video id. Reports which got one.

A `batchId` or one or more `contentId`s given with the command arrive in `$ARGUMENTS`.

## Two things that are easy to get wrong

**Publishing is a separate step from uploading, and it is opt-in.** An accepted upload sits
in Extuitive and nowhere else. It reaches the ad account only when `create_upload_batch` was
opened with `publishToMeta: true`, or when this job runs. Files that came through a one-time
link (`collect.md`) are never published on their own.

**It puts files into someone's ad account, so confirm before calling.** "Upload these" is not
"publish these". Say what will be registered — how many files, into which ad account — and
get a yes.

Publishing is also not creating an ad. It registers the asset; nothing runs, nothing spends.
Building an ad from the handle is `build.md`, and only when asked.

## 1. Find the files

In order of preference:

1. The `batchId` or `contentId`s you were given, or from an upload earlier in this
   conversation.
2. Otherwise `list_upload_batches`, newest first, and ask which.

Only `READY` files can be published — a file still `VALIDATING` or already `REJECTED` is
skipped as `not_ready`. If the batch has not settled, let `upload-status.md` finish first.

To see what is already published and what is not, `get_upload_batch_content` shows each
row's `metaPublishStatus`, and `metaPublishCounts` tallies the batch. Across the whole
workspace, `list_upload_content` with `status: ["READY"], metaPublishStatus: ["NONE"]` is
exactly the set this job would act on — `"NONE"` means never queued.

Use the workspace the batch was created in.

## 2. Confirm, then queue

Call `publish_upload_content_to_meta` with the `workspaceId` and **exactly one** of:

- `batchId` — every `READY`, not-yet-published file in the batch.
- `contentIds` — up to 250 specific files.

It only queues. The answer has `queued[]` — content ids now on their way — and `skipped[]`,
each with a `reason`:

| `reason` | Means |
| --- | --- |
| `already_published` | Has a handle already. Nothing to do |
| `already_publishing` | In flight from an earlier call |
| `not_ready` | Upload status is not `READY` |
| `not_found` | Not a file in this workspace |

None of these is an error to stop on. Say how many were queued and how many skipped, and why.

## 3. Watch `metaPublishStatus`

Poll `get_upload_batch_content` — or `list_upload_content` with the `contentIds`' batch, or
`get_upload_content` for one file — about every 5 seconds while `metaPublishPending` is above
zero. It is a separate lifecycle from the upload status, on the same row:

| `metaPublishStatus` | Means |
| --- | --- |
| `PENDING` | Queued |
| `PUBLISHING` | In progress |
| `PUBLISHED` | Done. The row now carries `metaImageHash` for an image, or `metaVideoId` and `metaVideoThumbUrl` for a video |
| `FAILED` | Gave up. `metaPublishError` says why. Nothing retries on its own; a later call to this job can. Until it does, the file **cannot go into an ad** — `create_meta_adcreative` needs the handle |
| absent | Never queued |

`metaPublishStatus: ["PUBLISHED"]` filters to the rows that are done; remember that
`metaPublishCounts` and `metaPublishPending` still describe the whole batch.

Give up after about 5 minutes and say where it got to.

## 4. Report

How many reached `PUBLISHED` out of how many queued, and every `FAILED` file by name with its
`metaPublishError`. Then stop. The handles are on the rows for whoever builds an ad next, and
`build.md` reads them from there — you do not need to list them unless asked.

## What can go wrong

| You see | It means | Do |
| --- | --- | --- |
| Everything `skipped` as `not_ready` | The batch has not settled | `upload-status.md` first |
| Everything `skipped` as `already_published` | The batch was opened with `publishToMeta: true`, or this ran before | Say so; nothing to do |
| `FAILED` with a `metaPublishError` about credentials or permissions | The workspace's Meta connection is unhealthy | Check `metaConnection.status` on `list_workspaces`; `connect.md` |
| `metaPublishPending` above zero for a long time | The upstream queue is slow | Report the count and stop polling; offer to look again |
| `workspace_access_denied` | Not a member of that workspace | Same rule as everywhere: name the refused id, use one that works |

## More detail

`tools.md` has every argument, the Meta publish lifecycle table, and the full error
vocabulary.
