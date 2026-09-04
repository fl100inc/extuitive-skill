/**
 * Where each host keeps its skills and its MCP configuration.
 *
 * The hosts disagree about almost everything, so the differences are described as data here
 * and every other module reads them from this table rather than branching on a host id of
 * its own. Two fields carry most of that weight, because they decide which code path a host
 * takes at all rather than merely which string it prints:
 *
 * - `skillDelivery` is `copy` for a host that scans a directory, and `bundle` for one that
 *   takes an upload. Claude Desktop is the second kind, which is why a ZIP writer exists.
 * - `mcpSetup` is `cli` for a host we can drive with a command, and `connector-ui` for one
 *   where the only supported route is a panel the person clicks through themselves.
 *
 * Notable asymmetries, all load-bearing:
 *
 * - Claude Code reads personal skills from `~/.claude/skills`. Codex scans two personal
 *   locations, `$CODEX_HOME/skills` and `~/.agents/skills`, and loads from both. Codex's
 *   own source calls the first one deprecated and the second current — but its bundled
 *   `$skill-installer` still writes to `$CODEX_HOME/skills`, and so does every agent that
 *   installs a skill from a URL. We install there so an Extuitive install lands where a
 *   Codex user's other skills already are. Earlier versions of this installer used
 *   `~/.agents/skills`; that is listed in `previousUserSkillsDirs` so install can migrate a
 *   copy out of it and doctor can explain a duplicate. If Codex ever stops scanning
 *   `$CODEX_HOME/skills`, swapping the two entries here is the whole change.
 * - Codex picks up new and changed skills between turns (since 0.97). Claude Code does too,
 *   and Claude Desktop reads them when a chat starts. None needs an application restart for
 *   the skill itself, which is why `loadsSkillsAtStartup` is false everywhere — kept as data
 *   rather than deleted so a host that regresses is a one-line fix.
 * - Every host connects MCP servers when a session starts, which is tracked separately from
 *   skills because it is what actually decides whether install has to end by telling
 *   someone to open a new session: the skill is live, the server it talks to is not.
 * - The host CLI is resolved, not assumed. See `resolveCli` for why a `codex` on PATH is not
 *   evidence that `codex` runs.
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { resolveCli } from "./exec.mjs";

/** Everything this package keeps for itself: backups, and bundles built for upload. */
export function stateRoot() {
  return join(homedir(), ".extuitive-skill");
}

/**
 * `CODEX_HOME` relocates everything Codex owns: its config file and, for us, its skills
 * directory. Read at call time rather than at import so tests can point a whole run at a
 * scratch directory.
 */
function codexHome() {
  const configured = process.env.CODEX_HOME;
  if (typeof configured === "string" && configured.trim() !== "") {
    return configured;
  }
  return join(homedir(), ".codex");
}

function claudeHome() {
  return join(homedir(), ".claude");
}

/**
 * Where the Claude Desktop app keeps its own state, which is not `~/.claude`.
 *
 * Only used to tell whether the app is on this machine. Nothing here is ever written: the
 * config file beside it takes stdio servers only, and an entry with a `url` makes Claude
 * Desktop delete the whole `mcpServers` block on next launch.
 */
function claudeDesktopHome() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude");
  }
  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    return typeof appData === "string" && appData.trim() !== ""
      ? join(appData, "Claude")
      : join(homedir(), "AppData", "Roaming", "Claude");
  }
  return join(homedir(), ".config", "Claude");
}

/**
 * Installed application bundles, for the case a state directory cannot cover: an app that
 * has been installed but never launched has written nothing anywhere yet.
 *
 * macOS only, because it is the one platform where an application's presence is a stable
 * path rather than a registry key or a package manager's opinion. Elsewhere the state
 * directory is the whole answer, which costs nothing but a first launch.
 */
function appBundles(names) {
  if (platform() !== "darwin") {
    return [];
  }
  return names.map((name) => `/Applications/${name}`);
}

export const HOST_IDS = ["claude", "codex", "claude-desktop"];

/**
 * Where a host's CLI might be, most specific first.
 *
 * An explicit `*_CLI_PATH` beats PATH, and PATH beats the desktop app bundles, which are
 * checked last because they only exist on macOS and only when the app is installed. The
 * bundle paths matter for exactly one case: a person who uses the Codex app and has never
 * installed the CLI, or has a broken one on PATH, still has a working binary.
 */
function cliCandidates(id) {
  if (id === "claude") {
    return [process.env.CLAUDE_CLI_PATH, "claude"];
  }
  if (id === "codex") {
    const candidates = [process.env.CODEX_CLI_PATH, "codex"];
    if (platform() === "darwin") {
      for (const root of ["/Applications", join(homedir(), "Applications")]) {
        candidates.push(join(root, "Codex.app", "Contents", "Resources", "codex"));
        candidates.push(join(root, "ChatGPT.app", "Contents", "Resources", "codex"));
      }
    }
    return candidates;
  }
  return [];
}

/**
 * Resolved once per process per host. Probing runs `--version`, which costs real time, and
 * `getHost` is called from every module; without a cache a single install would spawn the
 * CLI a dozen times to learn the same thing.
 */
const cliCache = new Map();

const NO_CLI = { state: "none", path: null, detail: "This host has no CLI.", tried: [] };

function resolvedCli(id) {
  if (cliCache.has(id) === false) {
    const candidates = cliCandidates(id);
    cliCache.set(id, candidates.length === 0 ? NO_CLI : resolveCli(candidates));
  }
  return cliCache.get(id);
}

/**
 * @returns {{
 *   id: string,
 *   label: string,
 *   surfaces: string,
 *   cli: string | null,
 *   cliCommand: string | null,
 *   cliResolution: { state: "available" | "broken" | "missing" | "none", path: string | null, detail: string },
 *   skillDelivery: "copy" | "bundle",
 *   mcpSetup: "cli" | "connector-ui",
 *   supportsScope: boolean,
 *   userSkillsDir: string,
 *   previousUserSkillsDirs: string[],
 *   projectSkillsDir: (cwd: string) => string,
 *   configPath: string | null,
 *   markerPaths: string[],
 *   loadsSkillsAtStartup: boolean,
 *   loadsMcpAtStartup: boolean,
 *   sessionNoun: string,
 *   invocationPrefix: string,
 *   invocationNote: string | null,
 * }}
 */
export function getHost(id) {
  if (id === "claude") {
    const cli = resolvedCli("claude");
    return {
      id: "claude",
      label: "Claude Code",
      // The Code tab of the Claude Desktop app reads this same directory, so installing
      // here is how that tab gets the skill. Its Chat and Cowork tabs do not.
      surfaces: "the claude CLI and the Code tab of the Claude Desktop app",
      cli: "claude",
      // What to spawn and what to print. The bare name when PATH has a working one; the
      // full path when only a fallback location did.
      cliCommand: cli.state === "available" ? cli.path : "claude",
      cliResolution: cli,
      skillDelivery: "copy",
      mcpSetup: "cli",
      supportsScope: true,
      userSkillsDir: join(claudeHome(), "skills"),
      previousUserSkillsDirs: [],
      projectSkillsDir: (cwd) => join(cwd, ".claude", "skills"),
      configPath: join(homedir(), ".claude.json"),
      markerPaths: [claudeHome()],
      loadsSkillsAtStartup: false,
      // The server is not live. Claude Code connects its MCP servers when a session starts,
      // and `/mcp` lists only what the session connected to — so the session that ran the
      // install cannot sign in to what the install just registered.
      loadsMcpAtStartup: true,
      sessionNoun: "session",
      invocationPrefix: "/",
      invocationNote: null,
    };
  }

  if (id === "codex") {
    const home = codexHome();
    const cli = resolvedCli("codex");
    return {
      id: "codex",
      // Not "Codex CLI". The Codex desktop app, the CLI and the IDE extension are one host
      // wearing three faces: they share `~/.codex/config.toml` for MCP and the same skills
      // directories, so a single install serves all three and a second host entry would
      // only copy the same files over themselves.
      label: "Codex",
      surfaces: "the Codex CLI, the Codex desktop app, and the IDE extension",
      cli: "codex",
      cliCommand: cli.state === "available" ? cli.path : "codex",
      cliResolution: cli,
      skillDelivery: "copy",
      mcpSetup: "cli",
      supportsScope: true,
      userSkillsDir: join(home, "skills"),
      // Where this installer used to put the skill. Deliberately not under CODEX_HOME: the
      // `.agents` convention is shared across tools and never moved with it.
      previousUserSkillsDirs: [join(homedir(), ".agents", "skills")],
      projectSkillsDir: (cwd) => join(cwd, ".agents", "skills"),
      configPath: join(home, "config.toml"),
      markerPaths: [home, ...appBundles(["Codex.app", "ChatGPT.app"])],
      loadsSkillsAtStartup: false,
      loadsMcpAtStartup: true,
      sessionNoun: "session",
      invocationPrefix: "$",
      invocationNote: null,
    };
  }

  if (id === "claude-desktop") {
    return {
      id: "claude-desktop",
      label: "Claude Desktop",
      // Scoped to the tabs this entry actually serves. The Code tab is Claude Code and is
      // set up by the `claude` host; saying so here is the difference between installing
      // once and installing twice.
      surfaces: "the Chat and Cowork tabs of the Claude Desktop app",
      // No CLI at all, which is why every other field about driving this host describes a
      // panel rather than a command.
      cli: null,
      cliCommand: null,
      cliResolution: NO_CLI,
      // Chat-tab skills are account-bound and run in Anthropic's code execution container.
      // There is no directory on this machine to copy into: the Customize > Skills panel
      // takes a `.zip` and syncs it to the account, which is also why the skill then works
      // on claude.ai and on other devices. Cowork reads a cache pulled back down from that
      // same account, so the upload is what reaches both tabs.
      skillDelivery: "bundle",
      // `claude_desktop_config.json` validates stdio servers only. An entry carrying a `url`
      // is not merely ignored — Claude Desktop rewrites the file on next launch with the
      // whole `mcpServers` block removed, taking any hand-written servers with it. A remote
      // HTTPS endpoint belongs in Settings > Connectors, which also handles the OAuth we
      // need and stores the token where the app expects it.
      mcpSetup: "connector-ui",
      // A skill uploaded to an account is not installed per project, so `--scope project`
      // has nothing to mean here.
      supportsScope: false,
      userSkillsDir: join(stateRoot(), "bundles"),
      previousUserSkillsDirs: [],
      projectSkillsDir: () => join(stateRoot(), "bundles"),
      configPath: null,
      markerPaths: [claudeDesktopHome(), ...appBundles(["Claude.app"])],
      // No application restart is in the way: an upload is live for new chats as soon as it
      // finishes, and a connector likewise. The open chat is what has the stale view, since
      // both are read when a chat starts.
      loadsSkillsAtStartup: false,
      loadsMcpAtStartup: true,
      sessionNoun: "chat",
      invocationPrefix: "/",
      // Worth stating because the other two hosts train the opposite habit. Chat has no
      // `$extuitive`; it selects a skill by matching the request against its description.
      invocationNote:
        "Claude picks the skill from its description, so ask for the underlying thing — " +
        '"upload these ads to Extuitive" — rather than typing a command.',
    };
  }

  throw new Error(`Unknown host: ${id}`);
}

export function allHosts() {
  return HOST_IDS.map(getHost);
}

/**
 * What we can tell about a host without asking the user.
 *
 * `cliAvailable` and `configPresent` are reported separately because they fail differently:
 * no working CLI means we cannot register the MCP server for them and have to print the
 * step, while no state directory usually means the host was never run. Either alone is
 * still enough to install skills, since that is only file copying.
 *
 * A host with no CLI is `cliAvailable: false` permanently rather than by accident, and the
 * modules that would otherwise print "put it on your PATH" read `mcpSetup` to tell the two
 * cases apart. A host whose CLI is found but does not run is `cliResolution.state ===
 * "broken"`, which still counts as "this host is here": the person has it, we just cannot
 * drive it.
 */
export function detectHost(id) {
  const host = getHost(id);
  const cliAvailable = host.cliResolution.state === "available";
  const configPresent = host.markerPaths.some((path) => existsSync(path));

  return {
    host,
    cliAvailable,
    configPresent,
    installed: cliAvailable || configPresent || host.cliResolution.state === "broken",
  };
}

export function detectHosts() {
  return HOST_IDS.map(detectHost);
}

/** The directory skills go into for a scope, with `--dir` overriding both. */
export function resolveSkillsRoot(host, { scope = "user", dir = null, cwd = process.cwd() } = {}) {
  if (dir !== null) {
    return dir;
  }
  if (host.supportsScope === false) {
    return host.userSkillsDir;
  }
  return scope === "project" ? host.projectSkillsDir(cwd) : host.userSkillsDir;
}

/**
 * Roots this installer wrote to in earlier versions, for the scope in question.
 *
 * Only a personal install to the default location has a history to migrate. A `--dir` or a
 * project install names exactly one directory and a copy anywhere else is not ours to move.
 */
export function previousSkillsRoots(host, { scope = "user", dir = null } = {}) {
  if (dir !== null || scope !== "user") {
    return [];
  }
  return host.previousUserSkillsDirs.filter((root) => root !== host.userSkillsDir);
}

/** `~/...` for display, without pretending paths outside home are under it. */
export function displayPath(path) {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(`${home}/`) === true) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}
