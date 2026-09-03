/**
 * The one place that knows how each host is told about an MCP server.
 *
 * Every command string for both hosts lives here. Install runs them, `doctor` prints them
 * when something is missing, and the skills reference neither — they tell the agent to run
 * `<npx> doctor` and relay what it says. That indirection exists because these
 * strings are the most likely thing in the package to go stale: they belong to Claude Code
 * and Codex, not to us, and a skill reciting a command that no longer exists is worse than
 * a skill that stays quiet. Keeping them in one module means a host CLI change is a fix
 * here and nowhere else.
 *
 * Registration deliberately shells out to each host's own CLI rather than editing its
 * config file. The file formats differ (JSON for Claude Code, TOML for Codex), both have
 * changed shape across versions, and a hand-written entry that a newer host rejects is
 * harder to diagnose than a command that failed loudly. Hand-editing is the fallback only
 * when the CLI is absent, and then it is printed for the user rather than applied.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_MCP_ENDPOINT, MCP_SERVER_NAME, NPX_COMMAND } from "./constants.mjs";
import { formatCommand, run } from "./exec.mjs";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * The command that registers the server.
 *
 * `--scope user` on Claude Code is not a preference. The default is `local`, which binds the
 * server to whichever directory the command ran in, while skills installed to
 * `~/.claude/skills` are available everywhere — so the default would produce a setup that
 * works in one project and looks broken in every other one.
 */
export function registerCommand(host, { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user" } = {}) {
  if (host.id === "claude") {
    const args = ["mcp", "add", "--transport", "http", MCP_SERVER_NAME, endpoint];
    if (scope === "project") {
      args.push("--scope", "project");
    } else {
      args.push("--scope", "user");
    }
    return { command: host.cli, args };
  }

  if (host.id === "codex") {
    return {
      command: host.cli,
      args: ["mcp", "add", MCP_SERVER_NAME, "--url", endpoint],
    };
  }

  throw new Error(`Unknown host: ${host.id}`);
}

/**
 * The command that takes the server back out.
 *
 * Claude Code needs the scope repeated. Removal looks in one scope at a time and defaults to
 * `local`, so a remove without `--scope user` reports success having deleted nothing — the
 * user-scoped entry install wrote is still there. Codex keeps a single list and takes only a
 * name.
 */
export function unregisterCommand(host, { scope = "user" } = {}) {
  if (host.id === "claude") {
    return {
      command: host.cli,
      args: ["mcp", "remove", MCP_SERVER_NAME, "--scope", scope === "project" ? "project" : "user"],
    };
  }

  if (host.id === "codex") {
    return { command: host.cli, args: ["mcp", "remove", MCP_SERVER_NAME] };
  }

  throw new Error(`Unknown host: ${host.id}`);
}

/**
 * How a person completes OAuth.
 *
 * Never run for them. The flow opens a browser and finishes against their own session, so
 * the honest thing is to name the step and stop. Claude Code offers both an in-session panel
 * and a CLI command; the panel is listed first because it is the one that works when the
 * server was just added and the session is already open.
 */
export function authInstructions(host) {
  if (host.id === "claude") {
    return {
      primary: "Run /mcp inside Claude Code, choose extuitive, and approve access.",
      alternative: formatCommand(host.cli, ["mcp", "login", MCP_SERVER_NAME]),
    };
  }

  if (host.id === "codex") {
    return {
      primary: formatCommand(host.cli, ["mcp", "login", MCP_SERVER_NAME]),
      alternative: null,
    };
  }

  throw new Error(`Unknown host: ${host.id}`);
}

/** The command that reports per-server health, which `doctor` prefers over its own probing. */
export function statusCommand(host) {
  return { command: host.cli, args: ["mcp", "list"] };
}

/** What to paste when the host CLI is not on PATH and we will not guess at its config. */
export function manualConfigSnippet(host, { endpoint = DEFAULT_MCP_ENDPOINT } = {}) {
  if (host.id === "codex") {
    return {
      path: host.configPath,
      language: "toml",
      body: `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${endpoint}"\n`,
    };
  }

  return {
    path: ".mcp.json (project) or ~/.claude.json (user)",
    language: "json",
    body: `${JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: { type: "http", url: endpoint },
        },
      },
      null,
      2,
    )}\n`,
  };
}

/**
 * Register the server, or explain how to.
 *
 * A failure here is reported, not thrown. Skills are already on disk by this point and are
 * useful the moment the server is registered by any means, so aborting the whole install
 * over a CLI that refused would leave a worse state than finishing and printing the step.
 */
export async function registerMcpServer(host, options = {}) {
  const { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user", dryRun = false, cliAvailable } = options;
  const { command, args } = registerCommand(host, { endpoint, scope });
  const rendered = formatCommand(command, args);

  if (cliAvailable === false) {
    return {
      status: "cli_missing",
      command: rendered,
      manual: manualConfigSnippet(host, { endpoint }),
    };
  }

  if (dryRun === true) {
    return { status: "skipped_dry_run", command: rendered };
  }

  const timeoutMs = 30_000;
  const result = run(command, args, { timeoutMs });
  if (result.ok === true) {
    return { status: "registered", command: rendered };
  }

  if (result.timedOut === true) {
    return {
      status: "failed",
      command: rendered,
      detail:
        `${host.cli} did not finish within ${timeoutMs / 1000}s and was stopped. It may be waiting ` +
        `for input, which it cannot receive here. Run it yourself in a terminal: ${rendered}`,
      manual: manualConfigSnippet(host, { endpoint }),
    };
  }

  // Adding a server that is already configured is a refusal, not a problem: the desired end
  // state is the one we already have. Detected by message because neither CLI gives it a
  // distinct exit code.
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (output.includes("already exists") === true || output.includes("already configured") === true) {
    return { status: "already_registered", command: rendered };
  }

  return {
    status: "failed",
    command: rendered,
    detail: (result.stderr || result.stdout).trim(),
    manual: manualConfigSnippet(host, { endpoint }),
  };
}

/**
 * Unregister the server, or explain how to.
 *
 * Reports rather than throws, for the same reason registration does: by the time this runs
 * the skills are already gone, and aborting on a CLI that refused would leave a half-removed
 * setup with no message about which half.
 */
export async function unregisterMcpServer(host, options = {}) {
  const { scope = "user", dryRun = false, cliAvailable } = options;
  const { command, args } = unregisterCommand(host, { scope });
  const rendered = formatCommand(command, args);

  if (cliAvailable === false) {
    return { status: "cli_missing", command: rendered };
  }

  if (dryRun === true) {
    return { status: "skipped_dry_run", command: rendered };
  }

  const timeoutMs = 30_000;
  const result = run(command, args, { timeoutMs });

  if (result.timedOut === true) {
    return {
      status: "failed",
      command: rendered,
      detail:
        `${host.cli} did not finish within ${timeoutMs / 1000}s and was stopped. Run it yourself ` +
        `in a terminal: ${rendered}`,
    };
  }

  // Checked before the exit status, not after, because removing a server that was never
  // there is a *success* for Codex: `codex mcp remove missing` prints "No MCP server named
  // 'missing' found." and exits 0. Reading only the exit code would report having removed
  // something that was not there, which is the one thing an uninstall must not invent.
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const absent = ["not found", "no such", "does not exist", "no mcp server"].some((phrase) =>
    output.includes(phrase),
  );
  if (absent === true) {
    return { status: "already_absent", command: rendered };
  }

  if (result.ok === true) {
    return { status: "unregistered", command: rendered };
  }

  return {
    status: "failed",
    command: rendered,
    detail: (result.stderr || result.stdout).trim(),
  };
}

/**
 * The flag line, matched without ever crossing a line break.
 *
 * `[^\S\n]` rather than `\s` is load-bearing. `\s` matches newlines, and since the bounds are
 * greedy an `\s*$` at the end consumes the terminating newline as part of the match — so
 * rewriting the value would delete the line break with it and produce
 * `[features]skills = false`, which is not valid TOML. Horizontal whitespace only keeps the
 * match inside its own line and lets `$` sit before the newline instead of after it.
 */
const FEATURE_FLAG_PATTERN = /^[^\S\n]*skills[^\S\n]*=[^\S\n]*(true|false)[^\S\n]*$/m;

/**
 * Whether Codex's experimental skills flag is on.
 *
 * Absent and `false` are reported separately because they need different words: one is
 * "this was never enabled", the other is "somebody turned it off", and telling the second
 * person to add a line they already have is a dead end.
 */
export async function readFeatureFlag(host) {
  if (host.featureFlag === null) {
    return { required: false, enabled: true, path: null };
  }

  const path = host.featureFlag.file;
  if (existsSync(path) === false) {
    return { required: true, enabled: false, present: false, path };
  }

  const contents = await readFile(path, "utf8");
  const section = /^\s*\[features\]\s*$/m.exec(contents);
  if (section === null) {
    return { required: true, enabled: false, present: false, path };
  }

  const after = contents.slice(section.index + section[0].length);
  const nextSection = /^\s*\[/m.exec(after);
  const body = nextSection === null ? after : after.slice(0, nextSection.index);
  const match = FEATURE_FLAG_PATTERN.exec(body);

  if (match === null) {
    return { required: true, enabled: false, present: false, path };
  }
  return { required: true, enabled: match[1] === "true", present: true, path };
}

/**
 * Turn the flag on, but only when explicitly allowed.
 *
 * This edits a file the user owns and did not ask us to touch, in a format where a clumsy
 * write can break unrelated settings, so it is gated behind `--write-config` and always
 * takes a timestamped backup first. An existing `skills = false` is rewritten in place
 * rather than duplicated, since a second key in the same table is a TOML error.
 */
export async function enableFeatureFlag(host, { dryRun = false } = {}) {
  const state = await readFeatureFlag(host);
  if (state.required === false || state.enabled === true) {
    return { status: "not_needed", path: state.path };
  }

  const path = state.path;
  if (dryRun === true) {
    return { status: "skipped_dry_run", path };
  }

  await mkdir(dirname(path), { recursive: true });

  let backup = null;
  let contents = "";
  if (existsSync(path) === true) {
    contents = await readFile(path, "utf8");
    backup = `${path}.backup-${timestamp()}`;
    await copyFile(path, backup);
  }

  const sectionHeader = /^\s*\[features\]\s*$/m.exec(contents);

  if (sectionHeader === null) {
    const separator = contents === "" || contents.endsWith("\n") === true ? "" : "\n";
    contents = `${contents}${separator}\n[features]\nskills = true\n`;
  } else if (FEATURE_FLAG_PATTERN.test(contents) === true) {
    contents = contents.replace(FEATURE_FLAG_PATTERN, "skills = true");
  } else {
    const insertAt = sectionHeader.index + sectionHeader[0].length;
    contents = `${contents.slice(0, insertAt)}\nskills = true${contents.slice(insertAt)}`;
  }

  await writeFile(path, contents, "utf8");
  return { status: "enabled", path, backup };
}

/**
 * Turn the flag back off.
 *
 * Rewrites the value in place rather than deleting the key or the `[features]` table it sits
 * in. This is a file the user owns, TOML, and possibly holding settings that have nothing to
 * do with us; a one-line value change is the smallest edit that undoes what install did, and
 * it leaves a readable `skills = false` behind instead of a table that may now be empty.
 *
 * Whether it is safe to do at all is the caller's decision — the flag governs every skill
 * Codex loads, not only ours.
 */
export async function disableFeatureFlag(host, { dryRun = false } = {}) {
  const state = await readFeatureFlag(host);
  if (state.required === false || state.enabled === false) {
    return { status: "not_needed", path: state.path };
  }

  const path = state.path;
  if (dryRun === true) {
    return { status: "skipped_dry_run", path };
  }

  const contents = await readFile(path, "utf8");

  // Scoped to the `[features]` body rather than run over the whole file, because `skills` is
  // a plausible key in another table and rewriting someone else's value would be a silent,
  // unrelated config change.
  const section = /^\s*\[features\]\s*$/m.exec(contents);
  if (section === null) {
    return { status: "not_needed", path };
  }
  const bodyStart = section.index + section[0].length;
  const after = contents.slice(bodyStart);
  const nextSection = /^\s*\[/m.exec(after);
  const bodyEnd = nextSection === null ? contents.length : bodyStart + nextSection.index;
  const body = contents.slice(bodyStart, bodyEnd);

  if (FEATURE_FLAG_PATTERN.test(body) === false) {
    return { status: "not_needed", path };
  }

  const backup = `${path}.backup-${timestamp()}`;
  await copyFile(path, backup);
  await writeFile(
    path,
    contents.slice(0, bodyStart) +
      body.replace(FEATURE_FLAG_PATTERN, "skills = false") +
      contents.slice(bodyEnd),
    "utf8",
  );

  return { status: "disabled", path, backup };
}

/** The literal lines a user needs when nothing can be done for them automatically. */
export function manualSteps(
  host,
  { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user", featureFlagEnabled = false } = {},
) {
  const steps = [];

  // Skipped when the flag is already on, because listing a step someone has just completed
  // reads as "this did not work" and invites them to do it twice.
  if (host.featureFlag !== null && featureFlagEnabled === false) {
    steps.push({
      title: `Enable skills in ${host.configPath}`,
      body: "[features]\nskills = true",
    });
  }

  const { command, args } = registerCommand(host, { endpoint, scope });
  steps.push({ title: "Register the MCP server", body: formatCommand(command, args) });

  const auth = authInstructions(host);
  steps.push({
    title: "Sign in",
    body: auth.alternative === null ? auth.primary : `${auth.primary}\n${auth.alternative}`,
  });

  if (host.loadsSkillsAtStartup === true) {
    steps.push({
      title: `Restart ${host.label}`,
      body: "Skills are read once at startup, so new ones are invisible until you restart.",
    });
  }

  steps.push({
    title: "Check it worked",
    body: `${NPX_COMMAND} doctor`,
  });

  // The prefix is not cosmetic. Codex reserves `/` for its own commands and answers an
  // unknown one with "Unrecognized command", which looks exactly like the skill failing
  // to install, so the working syntax has to be stated rather than inferred.
  steps.push({
    title: `Use it in ${host.label}`,
    body: `${host.invocationPrefix}extuitive init`,
  });

  return steps;
}
