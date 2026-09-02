/**
 * Process helpers.
 *
 * Everything here uses `spawnSync` with an argument array rather than a shell string. The
 * installer passes user-supplied values — an endpoint, a directory — straight into these
 * calls, and an argument array cannot be talked into running a second command the way a
 * shell string can.
 */
import { spawnSync } from "node:child_process";

/**
 * Whether a command is runnable, by asking the OS rather than guessing from a path.
 *
 * `where` on Windows, `which` elsewhere. A host can be installed without its CLI on PATH,
 * so a false here means "cannot drive it from a script", not "not installed" — callers
 * decide what to do with that distinction.
 */
export function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

/**
 * Run a command and hand back its outcome instead of throwing.
 *
 * Callers here are all doing setup that has a sensible fallback — print the manual step,
 * report a degraded check — so a non-zero exit is data, not an exception. A missing binary
 * surfaces as `ok: false` with `spawnError` set, which is different from a binary that ran
 * and refused.
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 30_000,
    ...options,
  });

  if (result.error !== undefined) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: String(result.error.message ?? result.error),
      spawnError: true,
      // Reported separately because it is the one failure with a different cause: the
      // command was found and started fine, it just never finished. Collapsing it into
      // "could not run" would send someone looking for a broken install instead.
      timedOut: result.error.code === "ETIMEDOUT",
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    spawnError: false,
    timedOut: false,
  };
}

/** A shell-ready rendering of a command, for printing a step the user has to run by hand. */
export function formatCommand(command, args) {
  const parts = [command, ...args].map((part) =>
    /[\s"'$`\\]/.test(part) === true ? JSON.stringify(part) : part,
  );
  return parts.join(" ");
}
