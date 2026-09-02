/**
 * What is wrong, and which step fixes it.
 *
 * Two rules shape everything here.
 *
 * First, prefer the host's own answer. `claude mcp list` and `codex mcp list` distinguish
 * "not registered" from "registered but not signed in", which an outside probe cannot: both
 * look identical from here, because an unauthenticated request gets the same 401 whether or
 * not any host knows the server exists. Our own probe is the fallback for when neither CLI
 * is installed.
 *
 * Second, never claim the sign-in worked. OAuth completes in a browser against the user's
 * own session and the token lands in the host's credential store, which is not ours to read.
 * Doctor reports what the host says and otherwise says "unknown" — an installer that
 * announced success it had not verified would be wrong in exactly the case that matters.
 */
import { DEFAULT_MCP_ENDPOINT, MCP_SERVER_NAME } from "./constants.mjs";
import { detectHosts } from "./hosts.mjs";
import { backupsRoot, findLegacyCopies, findShadowingBackups, inspectInstalledSkills } from "./install.mjs";
import { manualSteps, readFeatureFlag, statusCommand } from "./mcp-setup.mjs";
import { run } from "./exec.mjs";

/**
 * Ask the endpoint whether it is there.
 *
 * A 401 carrying `WWW-Authenticate` is the healthy answer: the server is reachable and is
 * correctly advertising where its OAuth metadata lives, which is what lets a host register
 * without a client id. Worth stating because lead-magnet's own `.env.example` claims an
 * unconfigured server returns 503 from this path — it does not, only `/oauth/token` does, so
 * a check written against that comment would call a working server broken.
 */
export async function probeEndpoint(endpoint = DEFAULT_MCP_ENDPOINT, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      // Following the redirect would turn a diagnosable 307 into whatever the login page
      // says about being POSTed to, which is a worse error about a different thing.
      redirect: "manual",
      signal: controller.signal,
    });

    const challenge = response.headers.get("www-authenticate");

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "elsewhere";
      return {
        state: "unexpected",
        detail:
          `Redirected to ${location} instead of returning a 401 challenge. The site is up, but /mcp ` +
          "is behind the browser session gate rather than exposed as an MCP endpoint, so no host can " +
          "sign in to it. This is a server-side deployment problem, not something the installer can fix.",
      };
    }

    if (response.status === 401) {
      return challenge === null
        ? {
            state: "unexpected",
            detail:
              "401 without a WWW-Authenticate header. The server is reachable but is not advertising its OAuth metadata, so hosts cannot discover how to sign in.",
          }
        : { state: "reachable", detail: "Reachable, awaiting sign-in.", challenge };
    }

    if (response.status === 200) {
      return { state: "authenticated", detail: "Reachable and this request was accepted." };
    }

    return {
      state: "unexpected",
      detail: `Responded ${response.status}. Expected 401 with a WWW-Authenticate header.`,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      state: "unreachable",
      detail: aborted === true ? `No response within ${timeoutMs}ms.` : String(error.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The host's own view of the server.
 *
 * Parsed from human-readable output, so it is written to degrade rather than mislead: a line
 * mentioning the server is enough to say it is registered, and only clear signals move it to
 * `needs_auth` or `failed`. Anything unrecognized stays `registered`, because "we could not
 * read the status" must not be reported as "it is broken".
 */
export function readHostServerStatus(host, { cliAvailable }) {
  if (cliAvailable === false) {
    return { state: "unknown", detail: `${host.cli} is not on PATH.` };
  }

  const { command, args } = statusCommand(host);
  const result = run(command, args, { timeoutMs: 20_000 });

  if (result.spawnError === true) {
    return { state: "unknown", detail: `Could not run ${command} ${args.join(" ")}.` };
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const line = output
    .split("\n")
    .find((candidate) => candidate.toLowerCase().includes(MCP_SERVER_NAME));

  if (line === undefined) {
    return { state: "absent", detail: `${host.label} has no server named ${MCP_SERVER_NAME}.` };
  }

  const lowered = line.toLowerCase();
  if (lowered.includes("needs authentication") === true || lowered.includes("not logged in") === true) {
    return { state: "needs_auth", detail: line.trim() };
  }
  if (lowered.includes("failed") === true) {
    return { state: "failed", detail: line.trim() };
  }
  if (lowered.includes("connected") === true) {
    return { state: "connected", detail: line.trim() };
  }
  return { state: "registered", detail: line.trim() };
}

function skillSummary(inspection) {
  const missing = inspection.skills.filter((skill) => skill.present === false);
  const mismatched = inspection.skills.filter(
    (skill) => skill.present === true && skill.nameMatches === false,
  );

  if (missing.length === inspection.skills.length) {
    return { state: "absent", missing, mismatched };
  }
  if (missing.length > 0 || mismatched.length > 0) {
    return { state: "partial", missing, mismatched };
  }
  return { state: "installed", missing, mismatched };
}

/** Everything doctor knows about one host. */
export async function diagnoseHost(detection, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd(), endpoint = DEFAULT_MCP_ENDPOINT } = options;
  const { host, cliAvailable, configPresent } = detection;

  const inspection = await inspectInstalledSkills(host, { scope, dir, cwd });
  const skills = skillSummary(inspection);
  const featureFlag = await readFeatureFlag(host);
  const legacy = await findLegacyCopies(host);
  const shadowingBackups = await findShadowingBackups(host, { scope, dir, cwd });
  const server = readHostServerStatus(host, { cliAvailable });

  const problems = [];

  if (skills.state === "absent") {
    problems.push({
      what: `No Extuitive skills in ${inspection.destinationRoot}.`,
      fix: "Run: npx extuitive-skill install",
    });
  } else if (skills.state === "partial") {
    if (skills.missing.length > 0) {
      problems.push({
        what: `Missing skills: ${skills.missing.map((skill) => skill.name).join(", ")}.`,
        fix: "Run: npx extuitive-skill install",
      });
    }
    for (const skill of skills.mismatched) {
      problems.push({
        what: `${skill.destination} declares name "${skill.declaredName}" but sits in a directory named "${skill.name}". Hosts key a skill on its directory, so this one will not load.`,
        fix: "Reinstall to restore the bundled copy: npx extuitive-skill install",
      });
    }
  }

  if (featureFlag.required === true && featureFlag.enabled === false) {
    problems.push({
      what: featureFlag.present === true
        ? `Skills are turned off in ${featureFlag.path} (skills = false).`
        : `Skills are not enabled in ${featureFlag.path}. Codex keeps them behind an experimental flag.`,
      fix: `Add to ${featureFlag.path}:\n  [features]\n  skills = true\nor rerun install with --write-config.`,
    });
  }

  for (const path of shadowingBackups) {
    problems.push({
      what: `A backup directory is sitting in the skills root (${path}). ${host.label} scans everything there, so it loads as a second, older skill.`,
      fix: `Move it out of the way: mv ${path} ${backupsRoot()}/\nor delete it if you no longer need it: rm -rf ${path}`,
    });
  }

  for (const copy of legacy) {
    problems.push({
      what: `A stale copy of ${copy.name} is in Codex's legacy skills directory (${copy.path}). Both locations are scanned, so this can shadow the current one.`,
      fix: `Remove it: rm -rf ${copy.path}`,
    });
  }

  if (server.state === "absent") {
    problems.push({
      what: `The MCP server is not registered with ${host.label}, so none of the Extuitive tools are available.`,
      fix: "Run: npx extuitive-skill install",
    });
  } else if (server.state === "needs_auth") {
    problems.push({
      what: `${host.label} has the server but is not signed in.`,
      fix: manualSteps(host, { endpoint, scope })
        .filter((step) => step.title === "Sign in")
        .map((step) => step.body)
        .join("\n"),
    });
  } else if (server.state === "failed") {
    problems.push({
      what: `${host.label} could not connect to the server: ${server.detail}`,
      fix: "Check the endpoint is reachable, then sign in again.",
    });
  }

  if (host.loadsSkillsAtStartup === true && skills.state === "installed") {
    problems.push({
      what: `${host.label} reads skills once at startup.`,
      fix: `Restart ${host.label} if you have not since installing.`,
      advisory: true,
    });
  }

  return {
    host,
    cliAvailable,
    configPresent,
    skillsRoot: inspection.destinationRoot,
    skills,
    inspection,
    featureFlag,
    legacy,
    shadowingBackups,
    server,
    problems,
  };
}

/** The whole picture: every detected host, plus one shared endpoint probe. */
export async function diagnose(options = {}) {
  const { hosts = null, endpoint = DEFAULT_MCP_ENDPOINT } = options;
  const detections = detectHosts().filter((detection) =>
    hosts === null ? detection.installed === true : hosts.includes(detection.host.id),
  );

  const reports = [];
  for (const detection of detections) {
    reports.push(await diagnoseHost(detection, options));
  }

  return {
    endpoint,
    probe: await probeEndpoint(endpoint),
    hosts: reports,
    anyHostDetected: detections.length > 0,
  };
}
