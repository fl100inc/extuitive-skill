/**
 * Values that appear in more than one place, defined once.
 */

export const PACKAGE_NAME = "extuitive-skill";

/** `owner/repo`, the one string that has to change if the repository moves. */
export const GITHUB_REPO = "fl100inc/extuitive-skill";

/**
 * How to invoke this tool, for every message that tells someone to run it again.
 *
 * Deliberately the GitHub specifier rather than a bare package name: the package is
 * installed straight from the repository, so `npx extuitive-skill` would send npm looking
 * in a registry that has never heard of it. Printing a command that cannot work is worse
 * than printing none, because it reads as the tool being broken.
 */
export const NPX_COMMAND = `npx github:${GITHUB_REPO}`;

/** Overridable with `--endpoint` for development against a local dev server. */
export const DEFAULT_MCP_ENDPOINT = "https://go.extuitive.com/mcp";

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
export const SKILL_COMMANDS = ["init", "select", "upload", "upload-status", "connect"];

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
