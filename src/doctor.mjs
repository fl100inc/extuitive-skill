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
import { DEFAULT_MCP_ENDPOINT, MCP_SERVER_NAME, NPX_COMMAND } from "./constants.mjs";
import { detectHosts, displayPath } from "./hosts.mjs";
import {
  backupsRoot,
  findShadowingBackups,
  inspectInstalledSkills,
  inspectSkillBundles,
} from "./install.mjs";
import { authInstructions, serverAvailabilityNotice, statusCommand } from "./mcp-setup.mjs";
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
 * Whether a line is about our server, as opposed to merely mentioning it.
 *
 * Claude Code lists claude.ai connectors alongside registered servers, and people name those
 * after the service — a connector called "Extuitive" prints a line carrying our name, our
 * endpoint and a healthy `✔ Connected`. Matching on substring finds it and reports a
 * registration that does not exist, which is the one wrong answer doctor must not give.
 * The name is the first token on the line: before the `:` Claude Code uses, or the run of
 * spaces Codex's table uses.
 */
function namesOurServer(line) {
  const [first = ""] = line.trim().split(/[:\s]/, 1);
  return first.toLowerCase() === MCP_SERVER_NAME;
}

/**
 * The columns of a fixed-width table row, cut where the header says they start.
 *
 * `codex mcp list` prints a table (`Name  Command  Args  Env  Cwd  Status  Auth`) whose
 * columns are padded to the widest value, so a row cannot be split on whitespace — an env
 * column full of `KEY=*****, KEY=*****` would swallow the ones after it. The header's
 * column starts are the only reliable cut points. Returns null when there is no header to
 * cut by, and the caller falls back to reading the row as prose.
 */
function tableColumns(lines, row) {
  const header = lines.find((line) => /^\s*Name\s+/.test(line) && /\bStatus\b/.test(line));
  if (header === undefined) {
    return null;
  }

  const names = [...header.matchAll(/\S+/g)];
  const columns = {};
  for (const [index, match] of names.entries()) {
    const start = match.index;
    const end = index + 1 < names.length ? names[index + 1].index : row.length;
    columns[match[0].toLowerCase()] = row.slice(start, end).trim();
  }
  return columns;
}

/**
 * Codex's auth vocabulary, from `McpAuthStatus` in its source, mapped onto ours.
 *
 * `OAuth` means a usable token is stored, i.e. signed in — not "uses OAuth". `NotLoggedIn`
 * means the server advertises OAuth and no token is stored. `BearerToken` is a static header
 * and counts as signed in. `Unsupported` is what a server with no auth at all reports, and
 * also what a disabled one reports, so on its own it says nothing about sign-in. Accepts
 * both the table's `OAuth`/`NotLoggedIn` spelling and `--json`'s `o_auth`/`not_logged_in`.
 */
function describeCodexAuth(raw) {
  const auth = String(raw).toLowerCase().replace(/[\s_-]/g, "");
  if (auth === "notloggedin") {
    return { state: "needs_auth", detail: "registered, not signed in" };
  }
  if (auth === "oauth" || auth === "bearertoken") {
    return { state: "connected", detail: "registered, signed in" };
  }
  return { state: "registered", detail: `registered (auth: ${raw || "unknown"})` };
}

/**
 * `codex mcp list --json`, which is the one host status we can read without guessing.
 *
 * Returns null when the flag is not supported or the output is not JSON, so the caller falls
 * back to the table. Anything else — including "the server is not in the list" — is a real
 * answer and is returned as one.
 */
function readCodexServerStatusJson(host, command, args) {
  const result = run(command, [...args, "--json"], { timeoutMs: 20_000 });
  if (result.spawnError === true || result.ok === false) {
    return null;
  }

  let entries;
  try {
    entries = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (Array.isArray(entries) === false) {
    return null;
  }

  const entry = entries.find((candidate) => String(candidate?.name ?? "").toLowerCase() === MCP_SERVER_NAME);
  if (entry === undefined) {
    const lookalike = entries.find((candidate) =>
      String(candidate?.name ?? "").toLowerCase().includes(MCP_SERVER_NAME),
    );
    return {
      state: "absent",
      detail: `${host.label} has no server named ${MCP_SERVER_NAME}.`,
      lookalike: lookalike === undefined ? null : String(lookalike.name),
    };
  }

  if (entry.enabled === false) {
    return {
      state: "disabled",
      detail: entry.disabled_reason ? `disabled: ${entry.disabled_reason}` : "disabled",
      entry,
    };
  }
  return { ...describeCodexAuth(entry.auth_status ?? ""), entry };
}

/**
 * The host's own view of the server.
 *
 * Parsed from human-readable output, so it is written to degrade rather than mislead: a line
 * naming the server is enough to say it is registered, and only clear signals move it to
 * `needs_auth`, `connected`, `disabled` or `failed`. Anything unrecognized stays
 * `registered`, because "we could not read the status" must not be reported as "it is
 * broken".
 *
 * A CLI that cannot be run at all is `unknown`, never `absent`. The earlier version got this
 * wrong for a broken `codex` shim: the spawn failure printed nothing that named the server,
 * so the server was reported missing and the fix offered was to register it again — with the
 * same broken binary.
 */
export function readHostServerStatus(host, { cliAvailable }) {
  // Distinct from `unknown`, which means "we could not read it this time". This one will
  // never be readable, so nothing about it is worth suggesting a fix for.
  const status = statusCommand(host);
  if (status === null) {
    return {
      state: "unverifiable",
      detail: `${host.label} has no CLI, so its connectors can only be seen in Settings > Connectors.`,
    };
  }

  if (cliAvailable === false) {
    return {
      state: "unknown",
      detail:
        host.cliResolution.state === "broken"
          ? host.cliResolution.detail
          : `${host.cli} is not on PATH, so the registration cannot be checked from here.`,
    };
  }

  const { command, args } = status;

  if (host.id === "codex") {
    const structured = readCodexServerStatusJson(host, command, args);
    if (structured !== null) {
      return structured;
    }
  }

  const result = run(command, args, { timeoutMs: 20_000 });

  if (result.spawnError === true) {
    return { state: "unknown", detail: `Could not run ${command} ${args.join(" ")}.` };
  }

  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const line = lines.find(namesOurServer);

  if (line === undefined) {
    // Reported rather than passed over, because from the outside it looks like the install
    // did nothing: the host lists something called Extuitive, and doctor says there is no
    // Extuitive server. Naming the other entry is the difference between those two facts.
    const lookalike = lines.find((candidate) => candidate.toLowerCase().includes(MCP_SERVER_NAME));
    return {
      state: "absent",
      detail: `${host.label} has no server named ${MCP_SERVER_NAME}.`,
      lookalike: lookalike === undefined ? null : lookalike.trim(),
    };
  }

  // Prefer the table's own columns when there are any. `Status` is enabled/disabled and
  // `Auth` is the sign-in state, and reading them by position means an env var containing
  // the word "failed" cannot be mistaken for the server having failed.
  const columns = tableColumns(lines, line);
  if (columns !== null && (columns.status !== undefined || columns.auth !== undefined)) {
    const status = (columns.status ?? "").toLowerCase();
    const summary = [columns.status, columns.auth].filter((part) => part).join(", ");

    if (status.includes("disabled") === true) {
      return { state: "disabled", detail: summary, columns };
    }
    return { ...describeCodexAuth(columns.auth ?? ""), columns, detail: summary };
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

/**
 * The same summary for a host whose skills are uploaded rather than copied.
 *
 * `built` rather than `installed`, and the difference is the point: an archive on this disk
 * says the upload is possible, not that it happened. Whether the account has the skill is
 * behind a browser session doctor cannot see, so it is never claimed either way.
 */
function bundleSummary(inspection) {
  const missing = inspection.skills.filter((skill) => skill.present === false);
  const stale = inspection.skills.filter(
    (skill) => skill.present === true && skill.current === false,
  );

  if (missing.length === inspection.skills.length) {
    return { state: "absent", missing, stale, mismatched: [] };
  }
  if (missing.length > 0 || stale.length > 0) {
    return { state: "partial", missing, stale, mismatched: [] };
  }
  return { state: "built", missing, stale, mismatched: [] };
}

/** Everything doctor knows about one host. */
export async function diagnoseHost(detection, options = {}) {
  const { scope = "user", dir = null, cwd = process.cwd() } = options;
  const { host, cliAvailable, configPresent } = detection;

  const bundled = host.skillDelivery === "bundle";
  const inspection = bundled === true
    ? await inspectSkillBundles(host, { dir, cwd })
    : await inspectInstalledSkills(host, { scope, dir, cwd });
  const skills = bundled === true ? bundleSummary(inspection) : skillSummary(inspection);
  const previous = inspection.previous ?? [];
  const shadowingBackups = await findShadowingBackups(host, { scope, dir, cwd });
  const server = readHostServerStatus(host, { cliAvailable });

  const problems = [];

  if (skills.state === "absent" && previous.length > 0) {
    // It loads from there, so this is not blocking — but a later install would create a
    // duplicate, and the person should know the location changed before that happens.
    problems.push({
      what: `Extuitive is installed at its previous location (${displayPath(previous[0].path)}). It still loads from there.`,
      fix: `Move it to ${displayPath(inspection.destinationRoot)} with: ${NPX_COMMAND} update`,
      advisory: true,
    });
  } else if (skills.state === "absent") {
    problems.push({
      what: bundled === true
        ? `No skill bundle built for ${host.label} in ${inspection.destinationRoot}.`
        : `No Extuitive skills in ${inspection.destinationRoot}.`,
      fix: `Run: ${NPX_COMMAND} install`,
    });
  } else if (skills.state === "partial") {
    if (skills.missing.length > 0) {
      problems.push({
        what: `Missing skills: ${skills.missing.map((skill) => skill.name).join(", ")}.`,
        fix: `Run: ${NPX_COMMAND} install`,
      });
    }
    for (const skill of skills.stale ?? []) {
      problems.push({
        what: `${skill.destination} was built from an older copy of the skill.`,
        fix: `Rebuild it, then upload the new one: ${NPX_COMMAND} update`,
      });
    }
    for (const skill of skills.mismatched) {
      problems.push({
        what: `${skill.destination} declares name "${skill.declaredName}" but sits in a directory named "${skill.name}". Hosts key a skill on its directory, so this one will not load.`,
        fix: `Reinstall to restore the bundled copy: ${NPX_COMMAND} install`,
      });
    }
  } else if (bundled === true) {
    // The one thing doctor genuinely cannot see, said plainly rather than left as a healthy
    // tick that means less than it looks like. A built bundle is a file on this disk; the
    // skill is in an account.
    problems.push({
      what: `The bundle is current, but whether it has been uploaded is only visible in ${host.label} under Customize > Skills.`,
      fix: `Upload ${inspection.skills[0]?.destination ?? "the bundle"} there if extuitive is not already listed.`,
      advisory: true,
    });
  }

  for (const path of shadowingBackups) {
    problems.push({
      what: `A backup directory is sitting in the skills root (${path}). ${host.label} scans everything there, so it loads as a second, older skill.`,
      fix: `Move it out of the way: mv ${path} ${backupsRoot()}/\nor delete it if you no longer need it: rm -rf ${path}`,
    });
  }

  if (skills.state !== "absent") {
    for (const copy of previous) {
      problems.push({
        what: `A second copy of ${copy.name} is at Extuitive's previous install location (${displayPath(copy.path)}). ${host.label} scans both, so the skill appears twice and the older body may be the one read.`,
        fix: `Migrate it (backs up anything that differs): ${NPX_COMMAND} update\nor remove it: rm -rf ${copy.path}`,
      });
    }
  }

  if (server.state === "unknown" && cliAvailable === false) {
    problems.push({
      what:
        host.cliResolution.state === "broken"
          ? `The ${host.cli} command does not run: ${host.cliResolution.detail}`
          : `The ${host.cli} command is not on PATH, so the MCP registration cannot be checked or changed from here.`,
      fix:
        host.cliResolution.state === "broken"
          ? `Reinstall the ${host.label} CLI, or point at a working one: CODEX_CLI_PATH=/path/to/codex ${NPX_COMMAND} doctor`
          : `Install the ${host.label} CLI, or register the server by hand — see: ${NPX_COMMAND} install`,
    });
  }

  if (server.state === "absent" && server.lookalike != null) {
    problems.push({
      what: `${host.label} has no server named ${MCP_SERVER_NAME}, but it does list "${server.lookalike}" — a separate entry that happens to share the name.`,
      fix:
        `If the Extuitive tools already work in your session, that entry is providing them and there is nothing to do here.\n` +
        `If they do not, register this one too: ${NPX_COMMAND} install`,
    });
  } else if (server.state === "absent") {
    problems.push({
      what: `The MCP server is not registered with ${host.label}, so none of the Extuitive tools are available.`,
      fix: `Run: ${NPX_COMMAND} install`,
    });
  } else if (server.state === "needs_auth") {
    const auth = authInstructions(host);
    problems.push({
      what: `${host.label} has the server but is not signed in.`,
      // The restart is part of the fix, not a footnote to it: on Claude Code the sign-in
      // panel is only reachable from a session that already connected to the server.
      fix:
        auth.inSession === true
          ? `${serverAvailabilityNotice(host)}\nThen: ${auth.primary}`
          : auth.primary,
    });
  } else if (server.state === "disabled") {
    problems.push({
      what: `${host.label} has the server but it is disabled (${server.detail}).`,
      fix: `Enable it in ${host.configPath}, or remove and re-add it: ${NPX_COMMAND} install`,
    });
  } else if (server.state === "failed") {
    problems.push({
      what: `${host.label} could not connect to the server: ${server.detail}`,
      fix: "Check the endpoint is reachable, then sign in again.",
    });
  } else if (server.state === "unverifiable") {
    // Advisory, not a problem. Nothing is known to be wrong; the place to look is simply
    // not a place a shell can reach, and reporting that as a failure would send someone
    // reinstalling a connector that is already there.
    problems.push({
      what: `Whether ${host.label} has the extuitive connector cannot be read from a shell.`,
      fix: "Check it yourself in Settings > Connectors.",
      advisory: true,
    });
  }

  // Raised for every host, because the failure it explains is the same everywhere:
  // everything reads healthy and the session still has no Extuitive tools. Doctor cannot
  // tell whether a new session has been started since — it runs in a shell, not in the
  // session — so it says the fact and leaves the "if you have not" to the reader. The skill
  // itself needs no restart on any host, which is why this speaks only of the server.
  // Not raised alongside `needs_auth`, whose fix already says it.
  const settled = ["registered", "connected", "unverifiable"].includes(server.state);
  if (["installed", "built"].includes(skills.state) === true && settled === true) {
    problems.push({
      what:
        server.state === "connected"
          ? `${host.label} connects MCP servers when a ${host.sessionNoun} starts, so a ${host.sessionNoun} older than this registration or sign-in does not have the Extuitive tools.`
          : serverAvailabilityNotice(host),
      fix: `If the Extuitive tools are not in your current ${host.sessionNoun}, start a new ${host.label} ${host.sessionNoun}.`,
      advisory: true,
    });
  }

  return {
    host,
    cliAvailable,
    cliResolution: host.cliResolution,
    configPresent,
    skillsRoot: inspection.destinationRoot,
    skills,
    inspection,
    previous,
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
