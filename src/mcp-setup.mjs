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
 * when the CLI is absent or broken, and then it is printed for the user rather than applied.
 *
 * Commands spawn `host.cliCommand`, which is whichever binary `resolveCli` found working —
 * possibly the one inside the desktop app bundle — and print the same, so a step someone is
 * told to run is the step that will actually run.
 *
 * Claude Desktop has neither a CLI nor a config file we may write, so everything below
 * takes a second path for it, chosen by `mcpSetup` rather than by host id. See
 * `connectorSteps` for why its config file is left alone even as a fallback.
 */
import { DEFAULT_MCP_ENDPOINT, MCP_SERVER_NAME, NPX_COMMAND } from "./constants.mjs";
import { formatCommand, run } from "./exec.mjs";

/**
 * The command that registers the server.
 *
 * `--scope user` on Claude Code is not a preference. The default is `local`, which binds the
 * server to whichever directory the command ran in, while skills installed to
 * `~/.claude/skills` are available everywhere — so the default would produce a setup that
 * works in one project and looks broken in every other one.
 */
export function registerCommand(host, { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user" } = {}) {
  if (host.mcpSetup !== "cli") {
    throw new Error(`${host.label} has no CLI to register with; use connectorSteps instead.`);
  }

  if (host.id === "claude") {
    const args = ["mcp", "add", "--transport", "http", MCP_SERVER_NAME, endpoint];
    if (scope === "project") {
      args.push("--scope", "project");
    } else {
      args.push("--scope", "user");
    }
    return { command: host.cliCommand, args };
  }

  if (host.id === "codex") {
    return {
      command: host.cliCommand,
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
  if (host.mcpSetup !== "cli") {
    throw new Error(`${host.label} has no CLI to unregister with; use connectorSteps instead.`);
  }

  if (host.id === "claude") {
    return {
      command: host.cliCommand,
      args: ["mcp", "remove", MCP_SERVER_NAME, "--scope", scope === "project" ? "project" : "user"],
    };
  }

  if (host.id === "codex") {
    return { command: host.cliCommand, args: ["mcp", "remove", MCP_SERVER_NAME] };
  }

  throw new Error(`Unknown host: ${host.id}`);
}

/**
 * The panel a person adds the server through, for a host with no CLI.
 *
 * This is the whole of Claude Desktop's setup, and it is deliberately not backed by a config
 * file fallback the way the CLI hosts are. `claude_desktop_config.json` validates stdio
 * servers only: an entry carrying a `url` is not ignored but *destructive* — Claude Desktop
 * rewrites the file on next launch with the entire `mcpServers` block stripped out, taking
 * any servers the person added by hand with it. There is a way to reach an HTTPS endpoint
 * from that file, by spawning `npx mcp-remote` as a stdio bridge, and it is left out on
 * purpose: it puts a second OAuth implementation and a background Node process between the
 * app and a server the app can already talk to directly.
 *
 * Written as steps rather than prose because the caller prints them numbered, and because a
 * connector added at the wrong level — the personal panel versus the organisation one — is
 * a failure that looks like the URL being wrong.
 */
export function connectorSteps(host, { endpoint = DEFAULT_MCP_ENDPOINT } = {}) {
  return [
    "Open Settings, then Connectors.",
    "Click Add custom connector.",
    `Paste this as the remote MCP server URL: ${endpoint}`,
    "Click Add. Claude checks the URL and fills in the authentication settings it finds.",
  ];
}

/**
 * How a person completes OAuth.
 *
 * Never run for them. The flow opens a browser and finishes against their own session, so
 * the honest thing is to name the step and stop.
 *
 * Claude Code gets `/mcp` and nothing else. `claude mcp login extuitive` is a real command
 * on new enough versions, but offering it here was a bug: what reads this output is usually
 * an agent inside a Claude Code session, and the one thing it can do with a shell command is
 * run it — in bash mode, in a session that has no `extuitive` server to log into, on a
 * version that may not have the subcommand at all. Every one of those fails in a way that
 * looks like the install failed. `/mcp` is the person's own panel and cannot be run by
 * mistake on their behalf.
 *
 * `inSession` says where the step happens, which decides the order of everything around it.
 * Claude Code signs in from inside a session and so cannot do it before restarting; Codex
 * signs in from a terminal and so can do it whenever.
 */
export function authInstructions(host) {
  if (host.id === "claude") {
    return {
      primary: "Run /mcp, choose extuitive, and approve access.",
      alternative: null,
      inSession: true,
    };
  }

  if (host.id === "codex") {
    return {
      // The desktop app has its own button for this — Settings > MCP servers, then
      // Authenticate — but the command is what gets printed, because it works from every
      // Codex surface including the app, and because one instruction that always applies
      // beats two that each apply sometimes.
      primary: formatCommand(host.cliCommand, ["mcp", "login", MCP_SERVER_NAME]),
      alternative: "In the Codex desktop app: Settings > MCP servers > Authenticate.",
      inSession: false,
    };
  }

  if (host.id === "claude-desktop") {
    return {
      // Adding the connector and signing in are one continuous flow here — the browser
      // opens off the back of the Add, or off Connect if it was dismissed. Naming the
      // second button matters for the person who closed the window and now sees a
      // connector sitting there doing nothing.
      primary: "Approve access in the browser window that opens after you add the connector.",
      alternative: "If you closed it, click Connect next to extuitive in Settings > Connectors.",
      inSession: false,
    };
  }

  throw new Error(`Unknown host: ${host.id}`);
}

/**
 * When the skill itself becomes usable, in the host's own terms.
 *
 * Every host now picks up new skills without a restart — Codex between turns, Claude Code as
 * files change, Claude Desktop when a chat starts — so this is one sentence and not an
 * instruction. It exists as a function because it is the sentence an installing agent will
 * repeat to the person, and it must not drift from what the host does: telling someone to
 * restart for a skill that is already live is how they learn to ignore the rest of the
 * output.
 */
export function skillAvailabilityNotice(host) {
  if (host.skillDelivery === "bundle") {
    // Nothing is live yet. The archive is on disk and the skill reaches the account only
    // once someone uploads it, so the sentence names the upload rather than a wait.
    return `Once uploaded, the skill is available in new ${host.sessionNoun}s.`;
  }
  if (host.loadsSkillsAtStartup === true) {
    return `${host.label} reads skills once at startup, so the skill appears after you start a new ${host.sessionNoun}.`;
  }
  if (host.id === "codex") {
    return "The skill is available on your next turn.";
  }
  return "The skill is available now.";
}

/**
 * When the MCP server — and so the Extuitive tools — becomes usable.
 *
 * Stated as its own sentence everywhere it appears because it is the step people skip and
 * then report as a broken install: the server is registered, the endpoint is fine, `mcp list`
 * agrees, and the session still has no Extuitive tools. On Claude Code it also gates sign-in,
 * so it has to be said before the sign-in step rather than after it.
 */
export function serverAvailabilityNotice(host) {
  if (host.id === "claude-desktop") {
    // No application restart: a connector and an uploaded skill are both live as soon as
    // they land. The chat is the thing with the stale view, and saying "restart Claude
    // Desktop" would send someone quitting an app that did not need it and still landing
    // back in the same conversation.
    return `${host.label} gives a chat its tools and skills when the chat starts, so neither appears in a conversation that was already open — start a new chat.`;
  }
  if (host.id === "claude") {
    return `${host.label} connects MCP servers when a session starts, so extuitive is not in the session you ran this from — and /mcp cannot sign in to a server that session never connected to.`;
  }
  return `${host.label} connects MCP servers when a session starts, so the Extuitive tools appear in a new session once you have signed in.`;
}

/**
 * The command that reports per-server health, which `doctor` prefers over its own probing.
 *
 * `null` for a host that has no CLI. Doctor reports that as "cannot be checked from here"
 * rather than as a problem, because the alternative — inferring from our own probe — would
 * report every unsigned-in server as missing and every missing one as unsigned-in.
 */
export function statusCommand(host) {
  if (host.mcpSetup !== "cli") {
    return null;
  }
  return { command: host.cliCommand, args: ["mcp", "list"] };
}

/**
 * What to paste when the host CLI cannot be run and we will not guess at its config.
 *
 * `null` for a connector-UI host. Not because there is no file — there is one, right where
 * you would expect — but because writing a remote server into it makes Claude Desktop
 * delete the whole `mcpServers` block on next launch. Printing a snippet somebody could
 * paste there would be handing them the destructive version of the thing they asked for.
 */
export function manualConfigSnippet(host, { endpoint = DEFAULT_MCP_ENDPOINT } = {}) {
  if (host.mcpSetup !== "cli") {
    return null;
  }

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
 *
 * `cli_missing` and `cli_broken` are different statuses because they have different fixes:
 * one person has to install the CLI, the other has one that does not run and should be told
 * which file it is.
 */
export async function registerMcpServer(host, options = {}) {
  const { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user", dryRun = false, cliAvailable } = options;

  // Not a degraded outcome and not a failure — it is how this host is set up, every time.
  // Kept distinct from `cli_missing` so callers can say "here is what to click" instead of
  // "something went wrong, here is what to click".
  if (host.mcpSetup === "connector-ui") {
    return { status: "manual_only", steps: connectorSteps(host, { endpoint }) };
  }

  const { command, args } = registerCommand(host, { endpoint, scope });
  const rendered = formatCommand(command, args);

  if (cliAvailable === false) {
    return {
      status: host.cliResolution.state === "broken" ? "cli_broken" : "cli_missing",
      command: rendered,
      detail: host.cliResolution.detail,
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

  if (host.mcpSetup === "connector-ui") {
    return {
      status: "manual_only",
      steps: [
        "Open Settings, then Connectors.",
        `Find ${MCP_SERVER_NAME} and remove it.`,
      ],
    };
  }

  const { command, args } = unregisterCommand(host, { scope });
  const rendered = formatCommand(command, args);

  if (cliAvailable === false) {
    return {
      status: host.cliResolution.state === "broken" ? "cli_broken" : "cli_missing",
      command: rendered,
      detail: host.cliResolution.detail,
    };
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
 * The literal lines a user needs when nothing can be done for them automatically.
 *
 * `bundle` is the path to an archive a bundle-delivery host expects to be uploaded. Passed
 * in rather than derived, because where it was written is the caller's decision — `--dir`
 * moves it — and a list of steps naming a file that is somewhere else is worse than no list.
 */
export function manualSteps(
  host,
  { endpoint = DEFAULT_MCP_ENDPOINT, scope = "user", bundle = null } = {},
) {
  const steps = [];

  if (host.skillDelivery === "bundle" && bundle !== null) {
    steps.push({
      title: "Upload the skill",
      body: `Settings > Capabilities: turn on code execution and file creation.\nCustomize > Skills: click +, then Create skill, then Upload a skill.\nChoose: ${bundle}`,
    });
  }

  if (host.mcpSetup === "connector-ui") {
    steps.push({
      title: "Add the connector",
      body: connectorSteps(host, { endpoint })
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n"),
    });
  } else {
    const { command, args } = registerCommand(host, { endpoint, scope });
    const snippet = manualConfigSnippet(host, { endpoint });
    steps.push({
      title: "Register the MCP server",
      body: `${formatCommand(command, args)}\nor add to ${snippet.path}:\n${snippet.body.trimEnd()}`,
    });
  }

  // The restart and the sign-in are ordered by where the sign-in happens. On Claude Code it
  // happens inside a session, and `/mcp` offers only servers that session connected to at
  // startup — so a list that signs in first and restarts second describes something nobody
  // can do. Codex signs in from a terminal and opens a new session afterwards for the tools.
  const auth = authInstructions(host);
  const restart = {
    title: `Start a new ${host.label} ${host.sessionNoun}`,
    body: serverAvailabilityNotice(host),
  };
  const signIn = {
    title: "Sign in",
    body: auth.alternative === null ? auth.primary : `${auth.primary}\n${auth.alternative}`,
  };

  steps.push(...(auth.inSession === true ? [restart, signIn] : [signIn, restart]));

  steps.push({
    title: "Check it worked",
    body: `${NPX_COMMAND} doctor`,
  });

  // The prefix is not cosmetic. Codex reserves `/` for its own commands and answers an
  // unknown one with "Unrecognized command", which looks exactly like the skill failing
  // to install, so the working syntax has to be stated rather than inferred. Where there is
  // no prefix at all, saying which one to type would be worse than saying nothing.
  steps.push({
    title: `Use it in ${host.label}`,
    body:
      host.invocationNote === null
        ? `${host.invocationPrefix}extuitive init`
        : host.invocationNote,
  });

  return steps;
}
