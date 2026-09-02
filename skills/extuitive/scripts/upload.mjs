#!/usr/bin/env node
/**
 * Sends creative files to storage for a batch the MCP tools already opened.
 *
 * This exists because the MCP tools deliberately never carry bytes: `create_upload_batch`
 * returns presigned destinations and something has to PUT to them. Doing that by hand from a
 * chat turn is not practical — every part of a large video needs a CRC32C over its own
 * bytes, plus retries.
 *
 * **This script holds no credential and makes no MCP call.** It is handed presigned URLs and
 * it sends bytes to them. Signing, opening the batch, completing a multipart upload, and
 * reporting the outcome are all tool calls the agent makes, which is what keeps the access
 * token in the host's credential store where it belongs. An earlier version called
 * `sign_upload_part` itself over raw HTTP and therefore needed a token in its plan; that was
 * a choice this script made, not something the protocol required, and it is gone.
 *
 * Usage:  node upload.mjs plan.json      (or: cat plan.json | node upload.mjs -)
 *
 * Plan:
 *   {
 *     "workspaceId": "...",
 *     "files": [
 *       { "path": "/abs/a.png", "destination": { …a PUT entry from create_upload_batch… } },
 *       {
 *         "path": "/abs/big.mp4",
 *         "destination": {
 *           "method": "MULTIPART",
 *           "contentId": "...", "fileName": "...", "uploadId": "...", "partBytes": 16777216,
 *           // One entry per part, from sign_upload_part. Parts are numbered from 1.
 *           "parts": [{ "partNumber": 1, "url": "...", "headers": { … } }]
 *         }
 *       }
 *     ]
 *   }
 *
 * Prints a JSON report on stdout. Exit code is 0 when every file landed, 1 otherwise.
 */
import { readFile, open, stat } from "node:fs/promises";

/** How many files move at once. Files, not parts: a multipart file is already several requests. */
const FILE_CONCURRENCY = 4;
const ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

/** Castagnoli polynomial, reversed. Not the CRC32 used by zip — they are not interchangeable. */
const CRC32C_POLYNOMIAL = 0x82f63b78;

let crcTable = null;

function getCrcTable() {
  if (crcTable !== null) {
    return crcTable;
  }
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ CRC32C_POLYNOMIAL : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * The value S3 expects for `x-amz-checksum-crc32c`: big-endian four bytes, base64.
 *
 * Byte order is not cosmetic. Little-endian produces a well-formed base64 string that S3
 * rejects on every part, which reads as a signing problem rather than a checksum one.
 */
function crc32cBase64(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[index]) & 0xff];
  }
  const checksum = (crc ^ 0xffffffff) >>> 0;

  const view = Buffer.alloc(4);
  view.writeUInt32BE(checksum, 0);
  return view.toString("base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class UploadFailure extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "UploadFailure";
    this.needsResign = options.needsResign === true;
    this.partNumber = options.partNumber ?? null;
  }
}

/**
 * Retries only what retrying can fix.
 *
 * A 403 on a presigned URL is almost always an expired signature, and re-sending the same
 * URL will fail identically however many times it is tried — it needs a new signature, which
 * only the agent can ask for. Reporting it as needing a re-sign is the useful answer;
 * retrying it would just spend four attempts arriving at the same place.
 */
async function sendWithRetry(label, send, { partNumber = null } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await send();
      if (response.ok === true) {
        return response;
      }

      if (response.status === 403) {
        throw new UploadFailure(`${label}: signature rejected or expired (403).`, {
          needsResign: true,
          partNumber,
        });
      }
      if (response.status < 500 && response.status !== 429) {
        throw new UploadFailure(`${label}: refused with ${response.status}.`);
      }
      lastError = new UploadFailure(`${label}: ${response.status} from storage.`);
    } catch (error) {
      if (error instanceof UploadFailure && error.needsResign === true) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < ATTEMPTS) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new UploadFailure(`${label}: failed.`);
}

/** One request, whole file. Headers go verbatim: the signature covers them. */
async function sendSinglePut(file, destination) {
  const body = await readFile(file.path);

  await sendWithRetry(destination.fileName, () =>
    fetch(destination.url, {
      method: "PUT",
      headers: destination.headers ?? {},
      body,
    }),
  );

  return {
    kind: "put",
    contentId: destination.contentId,
    fileName: destination.fileName,
  };
}

/**
 * Send every chunk of a multipart upload against signatures the agent already obtained.
 *
 * The part count is checked rather than trusted. The agent derives it from the `bytes` it
 * declared in the manifest, so a file edited between declaring and uploading would leave the
 * last chunk unsent and the object silently short — cheaper to refuse here than to discover
 * after `complete_upload` assembled something wrong.
 */
async function sendMultipart(file, destination) {
  const { size } = await stat(file.path);
  const partBytes = destination.partBytes;

  if (typeof partBytes !== "number" || partBytes <= 0) {
    throw new UploadFailure(`${destination.fileName}: destination has no usable partBytes.`);
  }

  const signedParts = Array.isArray(destination.parts) === true ? destination.parts : [];
  if (signedParts.length === 0) {
    throw new UploadFailure(
      `${destination.fileName}: no presigned parts in the plan. Call sign_upload_part for parts 1..N and put them on the destination as "parts".`,
    );
  }

  const expectedCount = Math.max(1, Math.ceil(size / partBytes));
  if (signedParts.length !== expectedCount) {
    throw new UploadFailure(
      `${destination.fileName}: ${signedParts.length} presigned part(s) for a file needing ${expectedCount} at ${partBytes} bytes each. The file on disk is ${size} bytes; re-declare it and sign again.`,
    );
  }

  const byNumber = new Map();
  for (const part of signedParts) {
    byNumber.set(part.partNumber, part);
  }

  const parts = [];
  const handle = await open(file.path, "r");

  try {
    for (let partNumber = 1; partNumber <= expectedCount; partNumber += 1) {
      const signed = byNumber.get(partNumber);
      if (signed === undefined) {
        throw new UploadFailure(
          `${destination.fileName}: no presigned URL for part ${partNumber}.`,
          { partNumber },
        );
      }

      const offset = (partNumber - 1) * partBytes;
      const length = Math.min(partBytes, size - offset);
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, offset);

      // Computed over the exact bytes being sent. The upstream signed this header, so S3
      // rejects the part if it is absent or does not match.
      const checksum = crc32cBase64(chunk);

      const response = await sendWithRetry(
        `${destination.fileName} part ${partNumber}`,
        () =>
          fetch(signed.url, {
            method: "PUT",
            headers: { ...signed.headers, "x-amz-checksum-crc32c": checksum },
            body: chunk,
          }),
        { partNumber },
      );

      const eTag = response.headers.get("etag");
      if (eTag === null) {
        throw new UploadFailure(
          `${destination.fileName} part ${partNumber}: storage returned no ETag.`,
          { partNumber },
        );
      }
      parts.push({ PartNumber: partNumber, ETag: eTag });
    }
  } finally {
    await handle.close();
  }

  return {
    kind: "multipart",
    contentId: destination.contentId,
    fileName: destination.fileName,
    uploadId: destination.uploadId,
    parts,
  };
}

async function sendOne(file) {
  const destination = file.destination;
  return destination.method === "MULTIPART"
    ? sendMultipart(file, destination)
    : sendSinglePut(file, destination);
}

async function run(plan) {
  const queue = [...plan.files];
  const uploaded = [];
  const multipart = [];
  const failed = [];
  const needsResign = [];
  const needsPartResign = [];

  async function worker() {
    for (;;) {
      const file = queue.shift();
      if (file === undefined) {
        return;
      }

      const destination = file.destination ?? {};

      try {
        const result = await sendOne(file);
        if (result.kind === "multipart") {
          multipart.push({
            contentId: result.contentId,
            fileName: result.fileName,
            uploadId: result.uploadId,
            parts: result.parts,
          });
        } else {
          uploaded.push({ contentId: result.contentId, fileName: result.fileName });
        }
      } catch (error) {
        const entry = {
          fileName: destination.fileName ?? file.path,
          contentId: destination.contentId,
          error: error instanceof Error ? error.message : String(error),
        };
        failed.push(entry);

        if (error instanceof UploadFailure && error.needsResign === true) {
          if (destination.method === "MULTIPART") {
            needsPartResign.push({
              fileName: entry.fileName,
              contentId: entry.contentId,
              uploadId: destination.uploadId,
              partNumber: error.partNumber,
            });
          } else {
            needsResign.push(entry.contentId);
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FILE_CONCURRENCY, plan.files.length) }, worker),
  );

  return { uploaded, multipart, failed, needsResign, needsPartResign };
}

async function readPlan(source) {
  if (source === "-" || source === undefined) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return JSON.parse(await readFile(source, "utf8"));
}

const plan = await readPlan(process.argv[2]);
if (Array.isArray(plan.files) === false || plan.files.length === 0) {
  console.error("Plan needs a non-empty files array.");
  process.exit(2);
}

const report = await run(plan);
console.log(JSON.stringify(report, null, 2));

// Transfers finishing is not the same as files being accepted. Every entry in `multipart`
// still needs a complete_upload call, and everything still needs polling with
// get_upload_batch_content; this only reports what reached storage.
process.exit(report.failed.length === 0 ? 0 : 1);
