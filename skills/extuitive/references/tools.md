# Extuitive MCP tools

Every tool the Extuitive MCP server exposes, with its arguments and what it gives back. Read
this when you need a schema or an error meaning; the `SKILL.md` files carry the procedures.

Server endpoint is `https://app.extuitive.com/mcp`. Every tool except `list_workspaces`,
`get_meta_setup_status`, and `create_meta_reconnect_link`'s sibling takes a `workspaceId`, and
membership is re-checked on every single call — a token issued before someone left a workspace
does not still reach it.

## Read this first: four things that cause wrong answers

1. **`count` is not the batch size.** In `get_upload_batch_content`, `count` describes only
   the rows returned after filtering. `statusCounts`, `pending`, and `settled` always describe
   the whole batch. Filtering to `["READY"]` and reading `count` makes an unfinished upload
   look complete.
2. **`complete_upload` uses S3's capitalisation.** `PartNumber` and `ETag`, not `partNumber`
   and `eTag`. They are the only non-camelCase fields in the entire surface.
3. **`sign_upload_part` does not give you the checksum.** You compute
   `x-amz-checksum-crc32c` yourself over the exact bytes of that part and send it as a header.
   The signature covers that header, so S3 rejects the part when it is missing or wrong. The
   bundled `scripts/upload.mjs` does this for you.
4. **No tool is annotated.** None declares `readOnlyHint`, `destructiveHint`, or an output
   schema, so nothing can be inferred about safety from the listing. `abort_upload` is
   destructive and carries no marking.

Results always arrive as both a JSON text block and `structuredContent` with the same payload.

## Workspaces

### `list_workspaces`

No arguments. Start every session here.

Returns `{ workspaces: [...] }`, each with:

| Field | Meaning |
| --- | --- |
| `workspaceId` | Pass this to every other tool |
| `name`, `slug` | Display |
| `role` | This caller's role in the workspace |
| `facebookAdAccountId` | The Meta ads account, or `null` |
| `isOwner` | Whether this caller owns the workspace |
| `metaConnection.status` | `healthy`, `expiring`, `token_invalid`, `missing_scope`, `ad_account_permission` |
| `metaConnection.daysUntilExpiry` | Whole days, or `null` when Meta gave no expiry |
| `metaConnection.canReconnect` | Whether *this* caller can fix it |

An empty list means no workspace, not no access. Follow with `get_meta_setup_status`.

## Meta connection

### `get_meta_setup_status`

No arguments. The right follow-up to an empty `list_workspaces`.

Returns `stage`, `connected`, `discoveredAdAccountCount`, `connectedAdAccountCount`, `action`,
`url` (absent only when setup is complete), and `nextStep`. Relay `nextStep` rather than
writing your own wording — it differs per stage so that someone already connected is not told
to connect again.

### `create_meta_reconnect_link`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | Caller must **own** it, not merely belong to it |

Returns `workspaceId`, `status`, `action`, `url`, `nextStep`. Check
`metaConnection.canReconnect` first; a non-owner gets `not_workspace_owner` and the right
answer is to ask the owner instead.

## Uploads

Bytes never pass through any of these. `create_upload_batch` mints presigned storage URLs and
the caller sends bytes to them directly.

### `get_upload_limits`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

Returns `multipartThresholdBytes`, `recommendedPartBytes`, `maxParts`, `maxFiles`, and
`media.image` / `media.video`, each with `maxBytes` and `contentTypes`. Image and video
ceilings differ by orders of magnitude. Never hardcode any of these.

### `create_upload_batch`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `files` | yes | 1 to `maxFiles` entries (250 when the server does not say) |
| `files[].fileName` | yes | Including extension |
| `files[].contentType` | yes | Must be an allowed type |
| `files[].bytes` | yes | Whole number, the real size |

Returns `batchId`, `metaAdAccountId`, `createdAt`, `fileCount`, and `files` — one destination
per file, in the order sent. A destination is one of:

- **PUT** — `method`, `fileName`, `contentId`, `url`, `fields`, `headers`, `expiresIn` (1800).
  Send the whole file to `url` with `headers` verbatim.
- **MULTIPART** — `method`, `fileName`, `contentId`, `uploadId`, `key`, `partBytes`. Needs
  `sign_upload_part` per part, then `complete_upload`.

### `resign_upload`

| Argument | Required |
| --- | --- |
| `workspaceId`, `contentId` | yes |

A fresh presigned PUT for one file. Every URL in a batch is signed at the same instant and
lasts 1800 seconds, so late files in a large batch can expire while early ones are still
transferring. Call on a 403, or when most of `expiresIn` has passed.

### `sign_upload_part`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `uploadId` | yes | |
| `partNumber` | yes | 1 to 10000 |

Returns `{ url, headers, expiresIn }`. Takes no bytes and no checksum, so all parts can be
signed up front before any transfer starts. Part count is `ceil(bytes / partBytes)`.

### `list_upload_parts`

| Argument | Required |
| --- | --- |
| `workspaceId`, `uploadId` | yes |

Returns a **bare array** of `{ PartNumber, Size, ETag }` — what storage already holds. Use it
to resume without re-sending parts that landed.

### `complete_upload`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `uploadId` | yes | |
| `parts` | yes | `{ PartNumber, ETag }[]`, capitalised exactly so |

Assembles the object. Returns `VALIDATING` — this does **not** mean accepted. Safe to retry.

### `abort_upload`

| Argument | Required |
| --- | --- |
| `workspaceId`, `uploadId` | yes |

Discards a multipart upload and its stored parts. Destructive, and not marked as such.

### `list_upload_batches`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

Batches newest first, each with `batchId`, `createdAt`, `fileCount`, `pending`, and
`statusCounts`. No file rows. The cheap way to check on an upload, and the way to find a batch
someone created through a browser link. May return `truncated: true` at 1000 items, with no
cursor beyond that.

### `get_upload_batch_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `batchId` | yes | |
| `status` | no | Array of statuses; omit for all |
| `mediaKind` | no | `image` or `video`; omit for both |

Returns `content`, `count`, `statusCounts`, `pending`, `settled`, `batchId`. Each content row:
`contentId`, `status`, and optionally `rejectionReason`, `fileName`, `mediaKind`, `bytes`,
`contentType`, `format`, `createdAt`, `updatedAt`, and `url` on a `READY` image.

Remember that filtering narrows `content` and `count` only.

### `get_upload_content`

| Argument | Required |
| --- | --- |
| `workspaceId`, `contentId` | yes |

One row, same shape as above. For a file uploaded on its own, which has no `batchId`.

### `create_browser_upload_link`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

Returns `{ workspaceId, url }` — a page where the person uploads from their browser. Use it
whenever you cannot make HTTP requests, and for very large video where signing every part
would take too many calls. The page requires them to be signed in, so the link grants nothing
on its own.

## Status lifecycle

| Status | Final | Counted in `pending` |
| --- | --- | --- |
| `CREATED` | no | yes |
| `UPLOADING` | no | yes |
| `VALIDATING` | no | yes |
| `READY` | **yes** | no |
| `REJECTED` | yes | no |
| `ABORTED` | yes | no |
| `EXPIRED` | no | yes |

`READY` is the only status that means a file uploaded successfully. Poll every 5 seconds, give
up after 5 minutes.

## Errors

Refusals come back as a result with `isError: true` and a payload of `{ error, message }`, so
they are yours to read and act on rather than hard failures.

| `error` | Meaning |
| --- | --- |
| `invalid_arguments` | A required argument is missing, empty, or out of range |
| `invalid_upload_body` | The `files` manifest was malformed |
| `missing_workspace_id` | `workspaceId` was blank |
| `workspace_access_denied` | Caller is not a member of that workspace |
| `not_workspace_owner` | Caller belongs to the workspace but does not own it |
| `upload_not_found` | No such content id |
| `upload_signing_unreachable` | Upstream signing service could not be reached |
| `upload_signing_timeout` | Upstream signing service timed out |
| `upload_signing_invalid_json` | Upstream returned something unparseable |
| `upload_signing_unconfigured` | Server is missing its upstream credentials |
| `upstream_{status}` | Upstream error with no more specific code |
| `internal_error` | Server-side fault; the detail is logged, not returned |

Genuine protocol faults — an unknown tool, malformed JSON-RPC — arrive as JSON-RPC errors
instead, and mean something is wrong with the call itself rather than its arguments.
