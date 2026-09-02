/**
 * Where each host keeps its skills and its MCP configuration.
 *
 * The two hosts disagree about almost everything except the shape of a skill directory, so
 * the differences are described as data here and every other module reads them from this
 * table rather than branching on a host id of its own.
 *
 * Notable asymmetries, all load-bearing:
 *
 * - Claude Code reads skills from `~/.claude/skills`. Codex moved to `~/.agents/skills` and
 *   left `~/.codex/skills` behind as a legacy location it still scans, so an upgrade can
 *   leave a stale copy shadowing a new one. `legacyUserSkillsDir` exists so `doctor` can
 *   say that out loud.
 * - Codex hides skills behind an experimental feature flag. Claude Code has no equivalent,
 *   so `featureFlag` is null there rather than a no-op default.
 * - Codex reads skills once at startup. Claude Code picks up new ones live. That single
 *   fact decides whether install has to end by telling someone to restart.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { commandExists } from "./exec.mjs";

/**
 * `CODEX_HOME` relocates everything Codex owns, including the config file the feature flag
 * lives in. Reading it at call time rather than at import keeps tests able to point a whole
 * run at a scratch directory.
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

export const HOST_IDS = ["claude", "codex"];

/**
 * @returns {{
 *   id: string,
 *   label: string,
 *   cli: string,
 *   userSkillsDir: string,
 *   legacyUserSkillsDir: string | null,
 *   projectSkillsDir: (cwd: string) => string,
 *   configPath: string,
 *   markerPath: string,
 *   featureFlag: { file: string, section: string, key: string } | null,
 *   loadsSkillsAtStartup: boolean,
 *   invocationPrefix: string,
 * }}
 */
export function getHost(id) {
  if (id === "claude") {
    return {
      id: "claude",
      label: "Claude Code",
      cli: "claude",
      userSkillsDir: join(claudeHome(), "skills"),
      legacyUserSkillsDir: null,
      projectSkillsDir: (cwd) => join(cwd, ".claude", "skills"),
      configPath: join(homedir(), ".claude.json"),
      markerPath: claudeHome(),
      featureFlag: null,
      // Project and personal skills are re-read as they change, so a fresh copy is live
      // without a restart.
      loadsSkillsAtStartup: false,
      invocationPrefix: "/",
    };
  }

  if (id === "codex") {
    const home = codexHome();
    return {
      id: "codex",
      label: "Codex CLI",
      cli: "codex",
      // The current canonical location. Deliberately not under CODEX_HOME: the `.agents`
      // convention is shared across tools, while CODEX_HOME only moves Codex's own state.
      userSkillsDir: join(homedir(), ".agents", "skills"),
      legacyUserSkillsDir: join(home, "skills"),
      projectSkillsDir: (cwd) => join(cwd, ".agents", "skills"),
      configPath: join(home, "config.toml"),
      markerPath: home,
      featureFlag: {
        file: join(home, "config.toml"),
        section: "features",
        key: "skills",
      },
      loadsSkillsAtStartup: true,
      invocationPrefix: "$",
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
 * no CLI means we cannot register the MCP server for them and have to print the step, while
 * no config directory usually means the host was never run. Either alone is still enough to
 * install skills, since that is only file copying.
 */
export function detectHost(id) {
  const host = getHost(id);
  const cliAvailable = commandExists(host.cli);
  const configPresent = existsSync(host.markerPath);

  return {
    host,
    cliAvailable,
    configPresent,
    installed: cliAvailable || configPresent,
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
  return scope === "project" ? host.projectSkillsDir(cwd) : host.userSkillsDir;
}
