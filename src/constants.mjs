/**
 * Values that appear in more than one place, defined once.
 *
 * `LOGIN_URL` is the only one here that cannot be derived from anything else. Every other
 * URL follows from the MCP endpoint, but the sign-up entry point is a separate property
 * with its own hostname, so if it ever moves this constant is the single line to change.
 */

export const PACKAGE_NAME = "extuitive-skill";

/** Where a person creates an Extuitive account or signs in. */
export const LOGIN_URL = "https://go.extuitive.com";

/** Overridable with `--endpoint` for development against a local dev server. */
export const DEFAULT_MCP_ENDPOINT = "https://app.extuitive.com/mcp";

/**
 * The name both hosts register the server under.
 *
 * Not one of Claude Code's reserved names (`workspace`, `claude-in-chrome`, `computer-use`,
 * `Claude Preview`, `Claude Browser`), which it refuses at add time.
 */
export const MCP_SERVER_NAME = "extuitive";

/**
 * Installed together and in this order.
 *
 * Both hosts derive a skill's invocable name from its directory, so these strings are the
 * command names as well: `/extuitive-init` in Claude Code, `$extuitive-init` in Codex. They
 * must equal the `name` in each SKILL.md's frontmatter.
 */
export const SKILL_NAMES = [
  "extuitive-init",
  "extuitive-upload",
  "extuitive-upload-status",
  "extuitive-workspace-setup",
];
