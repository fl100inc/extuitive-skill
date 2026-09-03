# `/extuitive upload` — send creative into a workspace

Uploads a set of local files to an Extuitive workspace and reports which ones were accepted.

Any folder or file paths the person gave follow the command in `$ARGUMENTS`. If they gave
none, ask what to upload before doing anything else.

## Before you start

**The MCP tools never carry file bytes.** `create_upload_batch` returns presigned storage
URLs; whoever has the files sends the bytes to those URLs directly.

So decide which case you are in:

- **You can run shell commands.** Use `../scripts/upload.mjs`, as below.
- **You cannot.** Do not call `create_upload_batch` — a batch you cannot fill sits unfinished
  and later reads as a failed upload. Call `create_browser_upload_link`, give the person the
  link, and skip to step 6.

If the Extuitive tools are missing entirely, read `init.md` instead.

## 1. Pick the workspace

If one was already chosen earlier in this conversation, use it, and name it in the first thing
you say — a mistaken choice is cheap to correct before the files move and expensive after.

Otherwise call `list_workspaces`. If there is more than one and the person did not say which,
ask; `select.md` covers how to lay the options out.

Ask even when two rows share a `facebookAdAccountId`. They are two workspaces, and the files
land in whichever one you use. **Do not pick by `role` or `isOwner`** — those govern who can
reconnect Meta and say nothing about uploading, so a workspace where they are `viewer` may
take files that the one where they are `owner` refuses. Describe both rows and let them
choose.

If it comes back **empty**, they have no workspace rather than no access. Read `connect.md`.
There is nothing to upload into yet.

## 2. Check the files against the limits

Call `get_upload_limits` for the workspace. It returns `maxFiles`, `multipartThresholdBytes`,
`recommendedPartBytes`, `maxParts`, and separate `maxBytes` and `contentTypes` for images and
for video — the two ceilings differ by orders of magnitude, so check each file against the one
for its own kind.

Never hardcode these numbers. They are server-owned and they change.

Set aside anything oversized or of a disallowed type and tell the person which and why. Do not
silently drop files.

## 3. Open the batch

Call `create_upload_batch` with every remaining file declared at once: `fileName`,
`contentType`, and the real size in `bytes`. Split into several batches if there are more than
`maxFiles`.

You get back a `batchId` and one destination per file, in the order you sent them. Keep the
`batchId` — step 6 and `upload-status.md` both need it.

If it refuses with `workspace_access_denied`, that workspace will not take these files no
matter what its row said. Move to another workspace they have, and tell them the batch is in
that one instead — including if it contradicts a workspace you named earlier. Do not retry the
refused id, and do not explain the refusal in terms of their role; it does not follow from it.

Each destination is one of two kinds:

- **`PUT`** — the whole file in one request. Carries `url`, `headers`, and `expiresIn`.
- **`MULTIPART`** — a large video. Carries `uploadId` and `partBytes`, and needs step 4 first.

## 4. Sign the parts of any MULTIPART file

Skip this if every destination is a `PUT`. Images never take the multipart path.

Work out the part count yourself: `ceil(bytes / partBytes)`, using the `bytes` you declared in
step 3 and the `partBytes` on that destination. You do not need to touch the file to do this.

Then call `sign_upload_part` for each part number from 1 to N. Each returns `{ url, headers,
expiresIn }`. Signing needs only the part number — no bytes, no checksum — so sign them all up
front, before any transfer starts.

Attach them to the destination as a `parts` array, each entry `{ partNumber, url, headers }`.

A 4 GB video is roughly 256 parts. If that is more calls than you want to make in one go, say
so and offer `create_browser_upload_link`, which handles large video without any of this.

## 5. Send the bytes

Write a plan file pairing each local path with its destination:

```json
{
  "workspaceId": "<workspace id>",
  "files": [
    {
      "path": "/abs/path/one.png",
      "destination": { "method": "PUT", "...": "..." }
    },
    {
      "path": "/abs/path/big.mp4",
      "destination": {
        "method": "MULTIPART",
        "uploadId": "...",
        "partBytes": 16777216,
        "parts": [{ "partNumber": 1, "url": "...", "headers": {} }]
      }
    }
  ]
}
```

Run the script using the absolute path of the skill directory this file sits in:

```bash
node <skill directory>/scripts/upload.mjs plan.json
```

It prints a JSON report with `uploaded`, `multipart`, `failed`, `needsResign`, and
`needsPartResign`. It handles retries, concurrency, and the CRC32C checksum each multipart
chunk needs. It holds no credential and makes no MCP call — it only sends bytes to URLs you
signed.

Three things it hands back rather than solving itself:

- **`multipart`** lists each large file with its `uploadId` and the `{ PartNumber, ETag }`
  array storage returned. Call `complete_upload` once per entry, passing those parts through
  exactly as given. Note the capitalisation — `PartNumber` and `ETag` are S3's own casing and
  the only fields in this surface that are not camelCase. **A multipart file is not uploaded
  until you do this.**
- **`needsResign`** lists `contentId`s whose presigned PUT expired. Every URL in a batch is
  signed at the same moment and lasts about 30 minutes, so in a large batch the last files can
  expire while the first are still going. Call `resign_upload` for each, put the fresh
  destination in a new plan, and run the script again for just those.
- **`needsPartResign`** is the same problem on one part of a multipart file. Call
  `sign_upload_part` again for that part number and re-run with just that file.

## 6. Report what was actually accepted

**A finished transfer is not an accepted file.** The bytes arriving only means storage has
them; the file is then checked, and it can still be rejected.

Poll `get_upload_batch_content` with the `batchId` about every 5 seconds until `settled` is
`true`. Give up after about 5 minutes and say so rather than claiming success.

**Report as you go — do not go silent.** Roughly every 15–30 seconds, say how many have
reached `READY` out of the batch, so a long upload does not look like a hang. Report once more
when `settled` is `true`.

`upload-status.md` covers the polling, the status table, and the reporting rules in full. Read
it rather than repeating the logic here.

## 7. Stop there

Report what landed and wait. Uploading is not an instruction to do anything further with the
files.
