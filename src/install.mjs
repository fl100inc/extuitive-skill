/**
 * Getting skill directories into a host, and taking them back out.
 *
 * Two shapes of host, kept apart by `skillDelivery`. Most scan a directory, so installing is
 * copying. Claude Desktop takes an upload instead — its Chat-tab skills are account-bound
 * rather than files on this machine — so installing there means building a `.zip` and
 * handing over the path.
 *
 * The only genuinely delicate part is overwriting. This writes into directories people also
 * author skills in by hand, so a reinstall that silently replaced an edited SKILL.md would
 * destroy work with no way back. Every overwrite moves the existing copy aside to a
 * timestamped sibling first, and the report says where it went.
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { SKILL_NAMES } from "./constants.mjs";
import { resolveSkillsRoot, stateRoot } from "./hosts.mjs";
import { createZip, zipHoldsEntries } from "./zip.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The `skills/` directory inside this package, wherever npx unpacked it. */
export function bundledSkillsDir() {
  return join(MODULE_DIR, "..", "skills");
}

/**
 * Backups live outside every skills root, deliberately.
 *
 * Both hosts scan their skills directory for `SKILL.md`, and Codex scans it recursively. A
 * backup kept as a sibling would therefore be discovered as a second, older copy of the skill
 * it was meant to preserve — the exact duplicate-skill problem that makes one shadow the
 * other. Keeping them here means a backup is recoverable without ever being loadable.
 */
export function backupsRoot() {
  return join(stateRoot(), "backups");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Every file under a directory, relative and sorted, so two trees can be compared. */
async function listFiles(root) {
  const found = [];
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() === true) {
        await walk(full);
      } else if (entry.isFile() === true) {
        found.push(relative(root, full));
      }
    }
  };
  await walk(root);
  return found.sort();
}

/**
 * Whether an installed skill is already exactly what we would write.
 *
 * Reinstalling is common — it is how someone upgrades — and backing up an identical copy
 * every time would leave a pile of directories that differ from each other in nothing. Skill
 * files are a few kilobytes each, so comparing contents outright is cheaper than the cleanup
 * it avoids.
 */
async function treesMatch(left, right) {
  let leftFiles;
  let rightFiles;
  try {
    leftFiles = await listFiles(left);
    rightFiles = await listFiles(right);
  } catch {
    return false;
  }

  if (leftFiles.join("\n") !== rightFiles.join("\n")) {
    return false;
  }

  for (const file of leftFiles) {
    const [a, b] = await Promise.all([
      readFile(join(left, file)),
      readFile(join(right, file)),
    ]);
    if (a.equals(b) === false) {
      return false;
    }
  }
  return true;
}

/**
 * The `name` a host will use for this skill.
 *
 * Read rather than assumed because a mismatch between frontmatter `name` and directory name
 * is the failure that makes a skill vanish without an error on both hosts. Install checks it
 * so the problem surfaces here instead of as "the skill isn't there" days later.
 */
async function readSkillName(skillDir) {
  const skillFile = join(skillDir, "SKILL.md");
  let contents;
  try {
    contents = await readFile(skillFile, "utf8");
  } catch {
    return null;
  }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (frontmatter === null) {
    return null;
  }
  const nameLine = /^name:\s*(.+)$/m.exec(frontmatter[1]);
  if (nameLine === null) {
    return null;
  }
  return nameLine[1].trim().replace(/^["']|["']$/g, "");
}

/** Every bundled skill, verified to be loadable before anything is copied anywhere. */
export async function readBundledSkills() {
  const root = bundledSkillsDir();
  const entries = await readdir(root, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (entry.isDirectory() === false) {
      continue;
    }
    const source = join(root, entry.name);
    const declaredName = await readSkillName(source);

    if (declaredName === null) {
      throw new Error(
        `Bundled skill "${entry.name}" has no readable name in its SKILL.md frontmatter.`,
      );
    }
    if (declaredName !== entry.name) {
      throw new Error(
        `Bundled skill "${entry.name}" declares name "${declaredName}". Both hosts key a skill on its directory name, so these must match.`,
      );
    }
    skills.push({ name: entry.name, source });
  }

  const found = skills.map((skill) => skill.name).sort();
  const expected = [...SKILL_NAMES].sort();
  if (found.join(",") !== expected.join(",")) {
    throw new Error(
      `Bundled skills are ${found.join(", ")} but expected ${expected.join(", ")}.`,
    );
  }

  return skills;
}

/**
 * Copy every skill into one host.
 *
 * Idempotent in the sense that matters: running it twice leaves the same result, and the
 * second run reports `replaced` rather than pretending nothing was there.
 */
export async function installSkills(host, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd(), dryRun = false } = options;
  const destinationRoot = resolveSkillsRoot(host, { scope, dir, cwd });
  const skills = await readBundledSkills();
  const results = [];

  if (dryRun === false) {
    await mkdir(destinationRoot, { recursive: true });
  }

  const runTimestamp = timestamp();

  for (const skill of skills) {
    const destination = join(destinationRoot, skill.name);
    const existed = existsSync(destination);
    let backup = null;

    if (existed === true && (await treesMatch(destination, skill.source)) === true) {
      results.push({ name: skill.name, destination, action: "unchanged", backup: null });
      continue;
    }

    if (existed === true && dryRun === false) {
      backup = join(backupsRoot(), runTimestamp, skill.name);
      await mkdir(dirname(backup), { recursive: true });
      await rename(destination, backup);
    }

    if (dryRun === false) {
      await cp(skill.source, destination, { recursive: true });
    }

    results.push({
      name: skill.name,
      destination,
      action: existed === true ? "replaced" : "created",
      backup,
    });
  }

  return { host: host.id, destinationRoot, skills: results, dryRun };
}

/**
 * A fixed timestamp for every file in a bundle, so that rebuilding unchanged files produces
 * an unchanged archive.
 *
 * Not what the freshness check relies on — that is `zipHoldsEntries`, which reads the CRCs
 * the archive already stores and so is immune to both the clock and the zlib underneath.
 * This is here so the artifact itself is reproducible: two builds of the same skill are the
 * same file, which is worth having for anyone diffing or caching one. 1980 is the ZIP epoch,
 * the one date the format stores exactly.
 */
const BUNDLE_EPOCH = new Date(Date.UTC(1980, 0, 1));

/** Every file under a skill, as ZIP entries rooted at a folder named for the skill. */
async function bundleEntries(source, name) {
  const files = await listFiles(source);
  const directories = new Set();

  for (const file of files) {
    const parts = file.split(/[/\\]/).slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      directories.add(`${name}/${parts.slice(0, depth).join("/")}`);
    }
  }

  const entries = [{ path: name, directory: true }];
  for (const directory of [...directories].sort()) {
    entries.push({ path: directory, directory: true });
  }
  for (const file of files) {
    entries.push({
      // Always forward slashes. The archive is read on whatever machine the account is
      // signed in on, not this one, and a backslash from a Windows build unpacks as a single
      // file with slashes in its name rather than as a folder.
      path: `${name}/${file.split(/[/\\]/).join("/")}`,
      data: await readFile(join(source, file)),
    });
  }
  return entries;
}

/**
 * Build the `.zip` a host asks people to upload.
 *
 * Reports `unchanged` when the archive it would write is byte-for-byte the one already
 * there, for the same reason the copying path does: rebuilding is how someone upgrades, and
 * an install that claims to have produced something new every time gives no way to tell a
 * real upgrade from a no-op.
 */
export async function buildSkillBundles(host, options = {}) {
  const { dir = null, cwd = process.cwd(), dryRun = false } = options;
  const destinationRoot = resolveSkillsRoot(host, { dir, cwd });
  const skills = await readBundledSkills();
  const results = [];

  if (dryRun === false) {
    await mkdir(destinationRoot, { recursive: true });
  }

  const runTimestamp = timestamp();
  // Our own bundle directory holds build output and nothing else, so a file being replaced
  // there is a bundle we wrote, regenerable from this same package. Anywhere else is a
  // directory the person named, and a file we find there is not ours to overwrite without
  // keeping a copy. Backing up either way would mean a new backup on every skill change,
  // each one a stale copy of an artifact nobody wants back.
  const ours = destinationRoot === host.userSkillsDir;

  for (const skill of skills) {
    const destination = join(destinationRoot, `${skill.name}.zip`);
    const entries = await bundleEntries(skill.source, skill.name);

    const existed = existsSync(destination);
    let backup = null;

    if (existed === true) {
      const current = await readFile(destination).catch(() => null);
      if (current !== null && zipHoldsEntries(current, entries) === true) {
        results.push({ name: skill.name, destination, action: "unchanged", backup: null });
        continue;
      }
      if (ours === false && dryRun === false) {
        backup = join(backupsRoot(), runTimestamp, `${skill.name}.zip`);
        await mkdir(dirname(backup), { recursive: true });
        await rename(destination, backup);
      }
    }

    const archive = createZip(entries, { modifiedAt: BUNDLE_EPOCH });
    if (dryRun === false) {
      await writeFile(destination, archive);
    }

    results.push({
      name: skill.name,
      destination,
      action: existed === true ? "replaced" : "created",
      backup,
      bytes: archive.length,
    });
  }

  return { host: host.id, destinationRoot, skills: results, dryRun };
}

/**
 * Delete the bundles, which is the only part of a bundle install that is ours to undo.
 *
 * The uploaded copy lives in the person's Anthropic account and comes off through the same
 * panel it went in by. Saying so is the caller's job; all this can do is stop leaving a
 * stale archive around for someone to upload months later.
 */
export async function removeSkillBundles(host, options = {}) {
  const { dir = null, cwd = process.cwd(), dryRun = false } = options;
  const destinationRoot = resolveSkillsRoot(host, { dir, cwd });
  const results = [];

  for (const name of SKILL_NAMES) {
    const destination = join(destinationRoot, `${name}.zip`);
    if (existsSync(destination) === false) {
      results.push({ name, destination, action: "absent" });
      continue;
    }
    if (dryRun === false) {
      await rm(destination, { force: true });
    }
    results.push({ name, destination, action: "removed" });
  }

  return { host: host.id, destinationRoot, skills: results, dryRun };
}

/**
 * Whether a bundle is built and current, which is as much as can be known from here.
 *
 * Deliberately not called "installed". Whether the archive was ever uploaded, and whether
 * the account still has it, are facts on the other side of a browser session — so this
 * reports the artifact and leaves the rest to be asked of the app.
 */
export async function inspectSkillBundles(host, options = {}) {
  const { dir = null, cwd = process.cwd() } = options;
  const destinationRoot = resolveSkillsRoot(host, { dir, cwd });
  const skills = await readBundledSkills();
  const found = [];

  for (const skill of skills) {
    const destination = join(destinationRoot, `${skill.name}.zip`);
    const current = existsSync(destination) === true ? await readFile(destination).catch(() => null) : null;

    if (current === null) {
      found.push({ name: skill.name, present: false, current: false, destination });
      continue;
    }

    found.push({
      name: skill.name,
      present: true,
      current: zipHoldsEntries(current, await bundleEntries(skill.source, skill.name)),
      destination,
    });
  }

  return { destinationRoot, skills: found };
}

/**
 * Remove the skills this package installed.
 *
 * Backups are left alone on purpose. They exist because a previous run found something it
 * did not put there, and deleting them during an uninstall would throw away the only copy of
 * whatever that was.
 */
export async function uninstallSkills(host, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd(), dryRun = false } = options;
  const destinationRoot = resolveSkillsRoot(host, { scope, dir, cwd });
  const results = [];

  for (const name of SKILL_NAMES) {
    const destination = join(destinationRoot, name);
    if (existsSync(destination) === false) {
      results.push({ name, destination, action: "absent" });
      continue;
    }
    if (dryRun === false) {
      await rm(destination, { recursive: true, force: true });
    }
    results.push({ name, destination, action: "removed" });
  }

  return { host: host.id, destinationRoot, skills: results, dryRun };
}

/**
 * Delete our skills from Codex's legacy `~/.codex/skills`.
 *
 * `findLegacyCopies` has always been able to name these, but only `doctor` used it, so an
 * uninstall that cleaned the current location left a still-loadable copy in the old one —
 * the skill would keep appearing after being removed. Only directories matching our own
 * skill names are touched; anything else in there belongs to someone else.
 */
export async function removeLegacyCopies(host, { dryRun = false } = {}) {
  const copies = await findLegacyCopies(host);

  for (const copy of copies) {
    if (dryRun === false) {
      await rm(copy.path, { recursive: true, force: true });
    }
  }

  return copies;
}

/**
 * Skills in a host's skills root that are not ours.
 *
 * Uninstall needs this before it touches Codex's feature flag: the flag governs every skill
 * Codex loads, so turning it off to tidy up after ourselves would quietly disable skills the
 * user wrote. Backup directories are excluded — they are not skills anyone is choosing to
 * keep loadable, and `doctor` already reports them as a problem in their own right.
 */
export async function otherSkillsInRoot(host, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd() } = options;
  const root = resolveSkillsRoot(host, { scope, dir, cwd });

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() === true &&
        SKILL_NAMES.includes(entry.name) === false &&
        /\.backup-/.test(entry.name) === false &&
        existsSync(join(root, entry.name, "SKILL.md")) === true,
    )
    .map((entry) => entry.name);
}

/** Which of our skills are present in a host's skills root, for `doctor`. */
export async function inspectInstalledSkills(host, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd() } = options;
  const destinationRoot = resolveSkillsRoot(host, { scope, dir, cwd });
  const found = [];

  for (const name of SKILL_NAMES) {
    const destination = join(destinationRoot, name);
    const skillFile = join(destination, "SKILL.md");

    if (existsSync(skillFile) === false) {
      found.push({ name, present: false, destination, nameMatches: false });
      continue;
    }

    const declaredName = await readSkillName(destination);
    found.push({
      name,
      present: true,
      destination,
      nameMatches: declaredName === name,
      declaredName,
    });
  }

  return { destinationRoot, skills: found };
}

/**
 * Backup directories sitting inside a skills root, which earlier versions of this installer
 * created as siblings of the skill they replaced.
 *
 * They are reported rather than deleted: the point of a backup is that someone may still
 * want it. But left in place they are scanned like any other skill, so `doctor` needs to say
 * so and point at the safe location.
 */
export async function findShadowingBackups(host, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd() } = options;
  const root = resolveSkillsRoot(host, { scope, dir, cwd });

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() === true &&
        /\.backup-/.test(entry.name) === true &&
        existsSync(join(root, entry.name, "SKILL.md")) === true,
    )
    .map((entry) => join(root, entry.name));
}

/**
 * A stale copy in Codex's legacy `~/.codex/skills` alongside a current one in
 * `~/.agents/skills`. Both are scanned, so the duplicate shows up twice in the picker and
 * the older body can be the one that gets read.
 */
export async function findLegacyCopies(host) {
  if (host.legacyUserSkillsDir === null) {
    return [];
  }

  const stale = [];
  for (const name of SKILL_NAMES) {
    const candidate = join(host.legacyUserSkillsDir, name);
    if (existsSync(join(candidate, "SKILL.md")) === true) {
      const info = await stat(candidate);
      stale.push({ name, path: candidate, modifiedAt: info.mtime.toISOString() });
    }
  }
  return stale;
}
