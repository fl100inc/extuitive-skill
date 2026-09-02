#!/usr/bin/env node
/**
 * `npx extuitive-skill install | uninstall | doctor`
 *
 * Argument parsing, prompting, and printing. All the decisions live in `src/`; this file
 * exists to turn them into something readable in a terminal.
 *
 * One rule worth stating: with no `--host` and no TTY, this refuses rather than guessing.
 * Writing into someone's home directory from a CI job that meant to do nothing of the sort
 * is not a mistake worth being convenient about.
 */
import { createInterface } from "node:readline/promises";
import process from "node:process";

import { DEFAULT_MCP_ENDPOINT, LOGIN_URL, PACKAGE_NAME, SKILL_NAMES } from "../src/constants.mjs";
import { detectHosts, getHost, HOST_IDS } from "../src/hosts.mjs";
import { installSkills, uninstallSkills } from "../src/install.mjs";
import {
  authInstructions,
  enableFeatureFlag,
  manualSteps,
  readFeatureFlag,
  registerMcpServer,
} from "../src/mcp-setup.mjs";
import { diagnose } from "../src/doctor.mjs";

const USAGE = `
${PACKAGE_NAME} — install the Extuitive agent skills and connect them to the Extuitive MCP server.

Usage
  npx ${PACKAGE_NAME} install [options]
  npx ${PACKAGE_NAME} uninstall [options]
  npx ${PACKAGE_NAME} doctor [options]

Options
  --host <claude|codex|both>  Which host to set up. Required without a TTY.
  --scope <user|project>      Install for every project or just this one. Default: user.
  --dir <path>                Install into this directory instead of the host's default.
  --endpoint <url>            MCP endpoint. Default: ${DEFAULT_MCP_ENDPOINT}
  --write-config              Allow editing the host config file to enable Codex skills.
  --dry-run                   Report what would change without changing anything.
  --yes, -y                   Accept defaults; never prompt.
  --json                      Machine-readable output (doctor only).
  --help, -h                  Show this message.

Skills installed
  ${SKILL_NAMES.join("\n  ")}

New to Extuitive? Create an account at ${LOGIN_URL}
`.trim();

function parseArgs(argv) {
  const options = {
    command: null,
    host: null,
    scope: "user",
    dir: null,
    endpoint: DEFAULT_MCP_ENDPOINT,
    writeConfig: false,
    dryRun: false,
    yes: false,
    json: false,
    help: false,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--write-config") {
      options.writeConfig = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--host") {
      options.host = rest.shift() ?? null;
    } else if (arg === "--scope") {
      options.scope = rest.shift() ?? "user";
    } else if (arg === "--dir") {
      options.dir = rest.shift() ?? null;
    } else if (arg === "--endpoint") {
      options.endpoint = rest.shift() ?? DEFAULT_MCP_ENDPOINT;
    } else if (arg.startsWith("-") === true) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.command === null) {
      options.command = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function validate(options) {
  if (options.command !== null && ["install", "uninstall", "doctor"].includes(options.command) === false) {
    throw new Error(`Unknown command: ${options.command}`);
  }
  if (["user", "project"].includes(options.scope) === false) {
    throw new Error(`--scope must be user or project, got: ${options.scope}`);
  }
  if (options.host !== null && [...HOST_IDS, "both"].includes(options.host) === false) {
    throw new Error(`--host must be claude, codex, or both, got: ${options.host}`);
  }
  try {
    new URL(options.endpoint);
  } catch {
    throw new Error(`--endpoint is not a valid URL: ${options.endpoint}`);
  }
}

const BULLET = "  •";

function heading(text) {
  console.log(`\n${text}`);
  console.log("─".repeat(Math.min(text.length, 72)));
}

function resolveHostIds(options, detections) {
  if (options.host === "both") {
    return [...HOST_IDS];
  }
  if (options.host !== null) {
    return [options.host];
  }
  return detections.filter((detection) => detection.installed === true).map((d) => d.host.id);
}

async function promptForHosts(detections) {
  const installed = detections.filter((detection) => detection.installed === true);

  if (installed.length === 0) {
    return [];
  }
  if (installed.length === 1) {
    console.log(`Found ${installed[0].host.label}.`);
    return [installed[0].host.id];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const labels = installed.map((detection, index) => `  ${index + 1}) ${detection.host.label}`);
    console.log("Found more than one host:");
    console.log(labels.join("\n"));
    console.log(`  ${installed.length + 1}) Both`);
    const answer = (await rl.question("Install into which? [both] ")).trim();

    if (answer === "" || answer === String(installed.length + 1)) {
      return installed.map((detection) => detection.host.id);
    }
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) === true && index >= 0 && index < installed.length) {
      return [installed[index].host.id];
    }
    return installed.map((detection) => detection.host.id);
  } finally {
    rl.close();
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function printManualSteps(host, options) {
  console.log(`\n  Finish setting up ${host.label} by hand:`);
  for (const [index, step] of manualSteps(host, options).entries()) {
    console.log(`\n  ${index + 1}. ${step.title}`);
    for (const line of step.body.split("\n")) {
      console.log(`       ${line}`);
    }
  }
}

async function commandInstall(options) {
  const detections = detectHosts();
  let hostIds = resolveHostIds(options, detections);

  const interactive = process.stdin.isTTY === true && options.yes === false;
  if (options.host === null) {
    if (interactive === true) {
      hostIds = await promptForHosts(detections);
    } else if (hostIds.length === 0) {
      throw new Error(
        "No host detected and no --host given. Pass --host claude, --host codex, or --host both.",
      );
    }
  }

  if (hostIds.length === 0) {
    console.log("Could not find Claude Code or Codex CLI on this machine.");
    console.log(`Install one, then run: npx ${PACKAGE_NAME} install`);
    console.log(`\nNew to Extuitive? Create an account at ${LOGIN_URL}`);
    return 1;
  }

  if (options.dryRun === true) {
    console.log("Dry run — nothing will be written.\n");
  }

  for (const hostId of hostIds) {
    const host = getHost(hostId);
    const detection = detections.find((candidate) => candidate.host.id === hostId);
    heading(host.label);

    const result = await installSkills(host, {
      scope: options.scope,
      dir: options.dir,
      dryRun: options.dryRun,
    });

    console.log(`  Skills → ${result.destinationRoot}`);
    for (const skill of result.skills) {
      const note = skill.backup === null ? "" : ` (previous copy kept at ${skill.backup})`;
      console.log(`${BULLET} ${skill.name} ${skill.action}${note}`);
    }

    const flag = await readFeatureFlag(host);
    let featureFlagEnabled = flag.required === false || flag.enabled === true;

    if (flag.required === true && flag.enabled === false) {
      const allowed =
        options.writeConfig === true ||
        (interactive === true && (await confirm(`\n  Enable skills in ${flag.path}?`)));

      if (allowed === true) {
        const applied = await enableFeatureFlag(host, { dryRun: options.dryRun });
        if (applied.status === "enabled") {
          featureFlagEnabled = true;
          const backup = applied.backup === null ? "" : ` (backup at ${applied.backup})`;
          console.log(`${BULLET} Enabled skills in ${applied.path}${backup}`);
        } else if (applied.status === "skipped_dry_run") {
          console.log(`${BULLET} Would enable skills in ${applied.path}`);
        }
      } else {
        console.log(`${BULLET} Skills are not enabled in ${flag.path}. Add:`);
        console.log("       [features]");
        console.log("       skills = true");
        console.log("     or rerun with --write-config.");
      }
    }

    const registration = await registerMcpServer(host, {
      endpoint: options.endpoint,
      scope: options.scope,
      dryRun: options.dryRun,
      cliAvailable: detection?.cliAvailable ?? false,
    });

    if (registration.status === "registered") {
      console.log(`${BULLET} Registered the MCP server (${registration.command})`);
    } else if (registration.status === "already_registered") {
      console.log(`${BULLET} MCP server already registered`);
    } else if (registration.status === "skipped_dry_run") {
      console.log(`${BULLET} Would run: ${registration.command}`);
    } else if (registration.status === "cli_missing") {
      console.log(`${BULLET} ${host.cli} is not on PATH, so the server was not registered.`);
      printManualSteps(host, { endpoint: options.endpoint, scope: options.scope, featureFlagEnabled });
      continue;
    } else {
      console.log(`${BULLET} Could not register the MCP server: ${registration.detail}`);
      printManualSteps(host, { endpoint: options.endpoint, scope: options.scope, featureFlagEnabled });
      continue;
    }

    const auth = authInstructions(host);
    console.log("\n  Next, sign in — this opens a browser and only you can complete it:");
    console.log(`    ${auth.primary}`);
    if (auth.alternative !== null) {
      console.log(`    or: ${auth.alternative}`);
    }
    if (host.loadsSkillsAtStartup === true) {
      console.log(`\n  Then restart ${host.label}; it reads skills once at startup.`);
    }
  }

  console.log(`\nNo Extuitive account yet? Create one at ${LOGIN_URL}`);
  console.log(`Check everything with: npx ${PACKAGE_NAME} doctor`);
  return 0;
}

async function commandUninstall(options) {
  const detections = detectHosts();
  const hostIds = resolveHostIds(options, detections);

  if (hostIds.length === 0) {
    console.log("No host detected. Nothing to remove.");
    return 0;
  }

  for (const hostId of hostIds) {
    const host = getHost(hostId);
    heading(host.label);
    const result = await uninstallSkills(host, {
      scope: options.scope,
      dir: options.dir,
      dryRun: options.dryRun,
    });

    for (const skill of result.skills) {
      console.log(`${BULLET} ${skill.name} ${skill.action}`);
    }

    console.log(`\n  The MCP server registration and your sign-in are ${host.label}'s, not ours.`);
    console.log(`  Remove them yourself if you want to: ${host.cli} mcp remove extuitive`);
  }

  return 0;
}

function describeProbe(probe) {
  if (probe.state === "reachable") {
    return "reachable, awaiting sign-in";
  }
  if (probe.state === "authenticated") {
    return "reachable and accepting requests";
  }
  if (probe.state === "unreachable") {
    return `unreachable — ${probe.detail}`;
  }
  return probe.detail;
}

async function commandDoctor(options) {
  const hostFilter = options.host === "both" || options.host === null ? null : [options.host];
  const report = await diagnose({
    hosts: hostFilter,
    scope: options.scope,
    dir: options.dir,
    endpoint: options.endpoint,
  });

  if (options.json === true) {
    const serializable = {
      ...report,
      hosts: report.hosts.map((entry) => ({ ...entry, host: entry.host.id })),
    };
    console.log(JSON.stringify(serializable, null, 2));
    return report.hosts.some((entry) =>
      entry.problems.some((problem) => problem.advisory !== true),
    )
      ? 1
      : 0;
  }

  heading("Endpoint");
  console.log(`  ${report.endpoint}`);
  console.log(`  ${describeProbe(report.probe)}`);

  if (report.anyHostDetected === false) {
    console.log("\nNo Claude Code or Codex CLI installation found.");
    console.log(`Install one, then run: npx ${PACKAGE_NAME} install`);
    return 1;
  }

  let blocking = 0;

  for (const entry of report.hosts) {
    heading(entry.host.label);
    console.log(`  Skills   ${entry.skillsRoot}`);

    for (const skill of entry.inspection.skills) {
      const mark = skill.present === true && skill.nameMatches === true ? "ok" : "--";
      console.log(`${BULLET} [${mark}] ${skill.name}`);
    }

    console.log(`  Server   ${entry.server.state} — ${entry.server.detail}`);

    const real = entry.problems.filter((problem) => problem.advisory !== true);
    const advisories = entry.problems.filter((problem) => problem.advisory === true);
    blocking += real.length;

    if (real.length === 0) {
      console.log("\n  Nothing blocking.");
    }
    for (const problem of real) {
      console.log(`\n  ${problem.what}`);
      for (const line of problem.fix.split("\n")) {
        console.log(`    ${line}`);
      }
    }
    for (const advisory of advisories) {
      console.log(`\n  Note: ${advisory.what}`);
      console.log(`    ${advisory.fix}`);
    }
  }

  console.log("");
  return blocking === 0 ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    validate(options);
  } catch (error) {
    console.error(`${error.message}\n`);
    console.error(USAGE);
    return 2;
  }

  if (options.help === true || options.command === null) {
    console.log(USAGE);
    return options.command === null && options.help === false ? 2 : 0;
  }

  if (options.command === "install") {
    return commandInstall(options);
  }
  if (options.command === "uninstall") {
    return commandUninstall(options);
  }
  return commandDoctor(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
