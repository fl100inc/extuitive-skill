/**
 * Values that appear in more than one place, defined once.
 */

/**
 * The name people type. This is the unscoped launcher package on npm (`packages/extuitive`),
 * which depends on `@extuitive/skill` — the package this file ships in — and does nothing
 * but import `bin/cli.mjs`. The usage text shows the launcher's name because that is the
 * command, not the implementation.
 */
export const PACKAGE_NAME = "extuitive";

/** `owner/repo`, the one string that has to change if the repository moves. */
export const GITHUB_REPO = "fl100inc/extuitive-skill";

/**
 * How to invoke this tool, for every message that tells someone to run it again.
 *
 * `npx extuitive` resolves the launcher from the npm registry, so it works from any
 * directory with nothing installed. `npx github:fl100inc/extuitive-skill` still runs the
 * unreleased `main` for anyone who wants that, but it is not what a fix message should
 * suggest.
 */
export const NPX_COMMAND = `npx ${PACKAGE_NAME}`;

/**
 * Where the pre-built Claude Desktop bundle is published.
 *
 * `install --host claude-desktop` builds the same archive locally, but the only thing the
 * archive is for is an upload through a panel, so a download link serves the person who
 * has no terminal — or no wish to open one — just as well. The release workflow attaches
 * `extuitive.zip` under this fixed name to every tagged release, and GitHub's `latest`
 * redirect keeps the URL stable across versions.
 */
export const BUNDLE_DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/extuitive.zip`;

/** Overridable with `--endpoint` for development against a local dev server. */
export const DEFAULT_MCP_ENDPOINT = "https://www.extuitive.com/mcp";

/**
 * The name every host registers the server under.
 *
 * Not one of Claude Code's reserved names (`workspace`, `claude-in-chrome`, `computer-use`,
 * `Claude Preview`, `Claude Browser`), which it refuses at add time.
 */
export const MCP_SERVER_NAME = "extuitive";

/**
 * One skill, whose directory name is also its command name.
 *
 * The CLI hosts key a skill on its directory, so this string is what someone types:
 * `/extuitive` in Claude Code, `$extuitive` in Codex. Claude Desktop has no prefix at all
 * and selects on the description instead, which is why `invocationNote` exists on a host
 * rather than a prefix being assumed everywhere.
 *
 * The individual jobs are arguments to it rather than skills of their own — `/extuitive
 * upload` — which is why there is only one entry here. It must equal the `name` in
 * SKILL.md's frontmatter.
 */
export const SKILL_NAMES = ["extuitive"];

/** The subcommands the skill routes, used for the usage text and nothing else. */
export const SKILL_COMMANDS = [
  "init",
  "select",
  "upload",
  "upload-status",
  "library",
  "collect",
  "publish",
  "build",
  "connect",
];

/**
 * What to suggest typing once the install is done.
 *
 * Natural language rather than `$extuitive init`, because that is how the skill is meant to
 * be reached and because the slash-vs-dollar prefix differs by host. The first one routes to
 * `init`, which verifies the connection end to end and is the right first thing to do; the
 * second is the job most people installed it for. Both phrases appear in SKILL.md's
 * description so the host's skill matcher recognises them.
 */
export const EXAMPLE_PROMPTS = ["Check my Extuitive connection", "Upload these images to Extuitive"];
