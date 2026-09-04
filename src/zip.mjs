/**
 * A ZIP writer, because one host takes skills as an upload rather than as files on disk.
 *
 * Claude Desktop's Customize > Skills panel accepts a `.zip` containing the skill folder and
 * nothing else — there is no directory it scans and no CLI to hand a path to. So the bundle
 * has to be built here.
 *
 * Written out longhand rather than shelling out to `zip` or taking a dependency. `zip` is not
 * on Windows and is not guaranteed anywhere else, `Compress-Archive` is a different command
 * with different quoting, and this package installs by `npx` straight from a repository
 * where a dependency would mean an install step before the installer runs. The format needed
 * here is the 1989 one: local headers, a central directory, an end record, no Zip64 and no
 * encryption. Skill bundles are kilobytes.
 */
import { deflateRawSync } from "node:zlib";

/**
 * CRC-32, which the format requires per entry and no Node built-in exposes.
 *
 * `>>> 0` after every step is not decoration. Bitwise operators in JavaScript produce signed
 * 32-bit integers, so a checksum with the high bit set comes out negative and writes as the
 * wrong four bytes — a corrupt archive that most tools open anyway and a stricter uploader
 * rejects.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A JavaScript `Date` as the MS-DOS date and time the format stores.
 *
 * Two-second resolution and a 1980 epoch, both inherent to the format. Dates before 1980
 * cannot be represented at all, so they are clamped rather than allowed to wrap into a
 * timestamp from the future.
 *
 * Read in UTC, which matters more than it looks. The format has no timezone field, so local
 * getters would encode the machine's offset into the bytes — and callers build archives they
 * expect to be a function of their contents alone. With local time, the 1980 epoch lands on
 * 1979 anywhere west of UTC, gets clamped back up to 1980 with December 31 still attached,
 * and shifts again if the same machine rebuilds from a different timezone. A comparison that
 * is supposed to mean "the skill changed" would then mean "you flew somewhere".
 */
function dosDateTime(date) {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time:
      (Math.floor(date.getUTCSeconds() / 2) & 0x1f) |
      ((date.getUTCMinutes() & 0x3f) << 5) |
      ((date.getUTCHours() & 0x1f) << 11),
    date:
      (date.getUTCDate() & 0x1f) |
      (((date.getUTCMonth() + 1) & 0x0f) << 5) |
      ((year - 1980) << 9),
  };
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Unix permissions live in the top 16 bits of the external attributes field. */
const FILE_MODE = (0o100644 << 16) >>> 0;
const DIRECTORY_MODE = (((0o040755 << 16) >>> 0) | 0x10) >>> 0;

/**
 * Build a ZIP from entries already in memory.
 *
 * `entries` is `{ path, data }` for files and `{ path, directory: true }` for folders, with
 * `path` always using forward slashes — the format says so, and a backslash from a Windows
 * caller produces an archive whose entries unpack as one file with a strange name.
 *
 * Directory entries are written even though most readers infer folders from file paths,
 * because "most" is doing real work in that sentence and the cost is thirty bytes each.
 *
 * @param {Array<{ path: string, data?: Buffer, directory?: boolean }>} entries
 * @param {{ modifiedAt?: Date }} [options]
 * @returns {Buffer}
 */
export function createZip(entries, { modifiedAt = new Date() } = {}) {
  const stamp = dosDateTime(modifiedAt);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const isDirectory = entry.directory === true;
    const name = isDirectory === true ? `${entry.path.replace(/\/$/, "")}/` : entry.path;
    const nameBytes = Buffer.from(name, "utf8");
    const raw = isDirectory === true ? Buffer.alloc(0) : entry.data;

    // Directories carry no payload, and deflating an empty buffer costs bytes rather than
    // saving them, so both are stored uncompressed.
    const deflate = isDirectory === false && raw.length > 0;
    const body = deflate === true ? deflateRawSync(raw, { level: 9 }) : raw;
    const method = deflate === true ? 8 : 0;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    // "Made by" a Unix system, so the permissions below are read rather than ignored.
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(isDirectory === true ? DIRECTORY_MODE : FILE_MODE, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

/**
 * What an existing archive contains, read from its central directory.
 *
 * Exists so callers can ask "is this bundle still the right one" without comparing
 * compressed bytes. Deflate output depends on the zlib built into the running Node, so two
 * archives can hold identical files and differ byte-for-byte after a Node upgrade — and this
 * package runs under `npx`, where that is a normal Tuesday. Comparing bytes would report the
 * bundle as stale, exit `doctor` non-zero, and ask for a re-upload that changes nothing.
 *
 * Only the central directory is read. Every field needed — name, CRC-32, uncompressed size —
 * is stored there in the clear, so nothing has to be inflated to answer the question.
 *
 * @returns {Array<{ path: string, crc: number, size: number }> | null} null if this is not
 *   an archive we wrote: truncated, corrupt, or carrying anything after its end record.
 */
export function readZipManifest(buffer) {
  const END_SIZE = 22;
  // Deliberately not a backwards scan for the signature. The format allows a trailing
  // comment, we never write one, and insisting the end record is the last thing in the file
  // is what makes appended or truncated bytes fail the check rather than pass it.
  const start = buffer.length - END_SIZE;
  if (start < 0 || buffer.readUInt32LE(start) !== END_OF_CENTRAL_DIRECTORY) {
    return null;
  }

  const count = buffer.readUInt16LE(start + 10);
  let offset = buffer.readUInt32LE(start + 16);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_HEADER) {
      return null;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    entries.push({
      path: buffer.toString("utf8", offset + 46, offset + 46 + nameLength),
      crc: buffer.readUInt32LE(offset + 16),
      size: buffer.readUInt32LE(offset + 24),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Whether an existing archive already holds exactly these entries.
 *
 * A CRC-32 and a length per file, which is what the archive itself stores and enough to
 * answer the only question being asked: has the skill changed since this was built. Two
 * different files sharing both is a collision nobody has produced in a skill directory.
 */
export function zipHoldsEntries(buffer, entries) {
  const existing = readZipManifest(buffer);
  if (existing === null || existing.length !== entries.length) {
    return false;
  }

  const describe = (list) =>
    list
      .map(({ path, crc, size }) => `${path}:${crc}:${size}`)
      .sort()
      .join("\n");

  return (
    describe(existing) ===
    describe(
      entries.map((entry) => {
        const raw = entry.directory === true ? Buffer.alloc(0) : entry.data;
        return {
          path: entry.directory === true ? `${entry.path.replace(/\/$/, "")}/` : entry.path,
          crc: crc32(raw),
          size: raw.length,
        };
      }),
    )
  );
}
