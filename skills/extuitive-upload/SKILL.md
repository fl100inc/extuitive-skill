---
name: extuitive-upload
description: Upload images and videos in bulk to an Extuitive workspace through the Extuitive MCP server, and report which files were accepted. Use when asked to upload, add, or import creative, ad images, ad videos, or a folder of assets into Extuitive.
argument-hint: "[folder or files]"
---

# Upload creative to Extuitive

Uploads a set of local files to an Extuitive workspace and reports which ones were accepted.

## The one thing to understand first

**The MCP tools never carry file bytes.** `create_upload_batch` returns presigned storage
URLs; whoever has the files must send the bytes to those URLs directly. There is no tool that
accepts a file.

So before anything else, decide which case you are in:

- **You can run shell commands** (you have Bash or equivalent). Use this skill's script.
- **You cannot run shell commands.** Do not call `create_upload_batch` — a batch you cannot
  fill just sits unfinished and shows up as a failed upload later. Call
  `create_browser_upload_link` instead, give the person the link, and skip to step 6.

## Steps

### 0. Check the tools are there

If the Extuitive tools are not available in this session, nothing below will work. Say so and
tell the person to run `npx extuitive-skill doctor`, which checks the connection and prints
the exact next step for their setup. Do not guess at setup commands yourself — they belong to
the host, they differ between hosts, and they change.

Signing in is a browser step the person performs. You cannot do it for them.

### 1. Pick the workspace

Call `list_workspaces`. If there is more than one and the person did not say which, ask.

If it comes back **empty**, they have no workspace yet rather than no access. Call
`get_meta_setup_status`, give them the `url` it returns, and relay its `nextStep`. Stop there
until they have finished; there is nothing to upload into yet.

### 2. Check the files against the limits

Call `get_upload_limits` for the workspace. It returns `maxFiles`, `multipartThresholdBytes`,
`recommendedPartBytes`, `maxParts`, and separate `maxBytes` and `contentTypes` for images and
for video — the two ceilings differ by orders of magnitude, so check each file against the one
for its own kind.

Never hardcode these numbers. They are server-owned and they change.

Set aside anything oversized or of a disallowed type and tell the person which and why. Do
not silently drop files.

### 3. Open the batch

Call `create_upload_batch` with every remaining file declared at once: `fileName`,
`contentType`, and the real size in `bytes`. Split into several batches if there are more than
`maxFiles`.

You get back a `batchId` and one destination per file, in the same order you sent them. Keep
the `batchId` — step 6 and the `extuitive-upload-status` skill both need it.

Each destination is one of two kinds:

- **`PUT`** — the whole file in one request. Carries `url`, `headers`, and `expiresIn`.
- **`MULTIPART`** — a large video. Carries `uploadId` and `partBytes`, and needs step 4 first.

### 4. Sign the parts of any MULTIPART file

Skip this if every destination is a `PUT`. Images never take the multipart path.

Work out the part count yourself: `ceil(bytes / partBytes)`, using the `bytes` you declared in
step 3 and the `partBytes` on that destination. You do not need to touch the file to do this.

Then call `sign_upload_part` for each part number from 1 to N. Each returns `{ url, headers,
expiresIn }`. Signing needs only the part number — no bytes, no checksum — so sign them all up
front before any transfer starts.

Attach them to the destination as a `parts` array, each entry `{ partNumber, url, headers }`.

A 4 GB video is roughly 256 parts. If that is more calls than you want to make in one go, tell
the person and offer `create_browser_upload_link` instead, which handles large video without
any of this.

### 5. Send the bytes

Write a plan file pairing each local path with its destination, then run the script:

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

Run it from this skill's own directory — use the absolute path of the directory this
`SKILL.md` is in:

```bash
node <this skill directory>/scripts/upload.mjs plan.json
```

It prints a JSON report with `uploaded`, `multipart`, `failed`, `needsResign`, and
`needsPartResign`. It handles retries, concurrency, and the CRC32C checksum each multipart
chunk needs. It holds no credential and makes no MCP call — it only sends bytes to URLs you
signed.

Three things it hands back to you rather than solving itself:

- **`multipart`** lists each large file with its `uploadId` and the `{ PartNumber, ETag }`
  array S3 returned. Call `complete_upload` once per entry, passing those parts through
  exactly as given. Note the capitalisation — `PartNumber` and `ETag` are S3's own casing and
  the only fields in this whole surface that are not camelCase. **A multipart file is not
  uploaded until you do this.**
- **`needsResign`** lists `contentId`s whose presigned PUT had expired. Every URL in a batch is
  signed at the same moment and lasts about 30 minutes, so in a large batch the last files can
  expire while the first are still going. Call `resign_upload` for each, put the fresh
  destination in a new plan, and run the script again for just those.
- **`needsPartResign`** is the same problem on a single part of a multipart file. Call
  `sign_upload_part` again for that part number and re-run with just that file.

### 6. Report what was actually accepted

**A finished transfer is not an accepted file.** The bytes arriving only means storage has
them; the file is then checked, and it can still be rejected.

Poll `get_upload_batch_content` with the `batchId` about every 5 seconds until `settled` is
`true`. Give up after about 5 minutes and say so rather than claiming success.

**Report as you go — do not go silent.** Tell the person roughly every 15–30 seconds how many
have reached `READY` out of the batch, so a long upload does not look like a hang. Then report
once more when `settled` is `true`. The `extuitive-upload-status` skill covers this in full,
and you can hand off to it rather than repeating the logic here.

Statuses:

- `READY` — accepted. This is the only status that counts as a successful upload. A `READY`
  image also carries a short-lived `url` you can use to show or fetch it.
- `VALIDATING` — still being checked. Keep polling.
- `REJECTED` — refused. Name the file and give its `rejectionReason`.
- `ABORTED` — abandoned. Final.
- `CREATED` / `UPLOADING` — the transfer has not finished landing yet.
- `EXPIRED` — the destination went unused. Not final; it can still land.

Only `READY`, `REJECTED`, and `ABORTED` are final. `VALIDATING` and `EXPIRED` are both counted
in `pending`.

**Watch out:** if you pass a `status` filter, `count` describes only the rows it returned,
while `statusCounts`, `pending`, and `settled` always describe the whole batch. Asking for
`status: ["READY"]` and reading `count` as the batch size will make an unfinished upload look
complete.

If the person uploaded through a browser link instead, watch `list_upload_batches` for the new
batch, then read it the same way.

### 7. Stop there

Uploading files is not an instruction to do anything with them. Thirty images is not a request
for thirty ads. Report what landed and wait.

## More detail

`references/tools.md` has every tool's arguments, the full error vocabulary, and the status
lifecycle.
