/**
 * Process helpers.
 *
 * Everything here uses `spawnSync` with an argument array rather than a shell string. The
 * installer passes user-supplied values — an endpoint, a directory — straight into these
 * calls, and an argument array cannot be talked into running a second command the way a
 * shell string can.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
 * Find a CLI that actually runs, out of several places it might be.
 *
 * "On PATH" is not the same as "works". On this very machine `which codex` finds an npm
 * wrapper whose vendored binary is missing, and every invocation dies with `spawn … ENOENT`
 * while the real, working `codex` sits inside the Codex desktop app bundle. An installer
 * that trusted `which` would register nothing and then report the server as "not
 * registered" rather than "could not ask" — the wrong diagnosis with the wrong fix.
 *
 * So each candidate is run with `--version` first. Bare names are looked up on PATH; absolute
 * paths are checked for existence. The first candidate that exits 0 wins and is what every
 * later command spawns. If none work, the distinction between "found but broken" and "not
 * found anywhere" is preserved, because doctor needs to say which.
 *
 * Returns `{ state: "available" | "broken" | "missing", path, detail, tried }`. For a bare
 * name that works, `path` is the bare name, so printed commands stay short.
 */
export function resolveCli(candidates, { timeoutMs = 5_000 } = {}) {
  const tried = [];
  let firstBroken = null;

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      continue;
    }

    const isBare = candidate.includes("/") === false && candidate.includes("\\") === false;
    if (isBare === true && commandExists(candidate) === false) {
      tried.push({ path: candidate, state: "missing" });
      continue;
    }
    if (isBare === false && existsSync(candidate) === false) {
      tried.push({ path: candidate, state: "missing" });
      continue;
    }

    const probe = run(candidate, ["--version"], { timeoutMs });
    if (probe.ok === true) {
      tried.push({ path: candidate, state: "available" });
      return {
        state: "available",
        path: candidate,
        detail: `${probe.stdout.trim() || probe.stderr.trim()}`.split("\n")[0],
        tried,
      };
    }

    const detail = (probe.stderr || probe.stdout).trim().split("\n")[0] || `exit ${probe.status}`;
    tried.push({ path: candidate, state: "broken", detail });
    if (firstBroken === null) {
      firstBroken = { path: candidate, detail };
    }
  }

  if (firstBroken !== null) {
    return {
      state: "broken",
      path: firstBroken.path,
      detail: `${firstBroken.path} is present but does not run: ${firstBroken.detail}`,
      tried,
    };
  }
  return { state: "missing", path: null, detail: "Not found on PATH or in any known location.", tried };
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

/**
 * Run a command that a person may be part of, watching its output as it goes.
 *
 * `run` is right for commands that finish on their own. This exists for the one that does
 * not: `codex mcp add --url` writes the config and then opens a browser and waits for the
 * person to sign in, however long that takes. Buffering that behind `spawnSync` hides the
 * authorize URL until the command ends, and ending it on a short timeout kills the local
 * callback listener the browser is about to redirect to — the sign-in the person just
 * completed fails at the last step, and the installer reports the registration as failed
 * when the config was written in the first second.
 *
 * So output is handed to `onLine` as it arrives, for the caller to echo, and is also
 * collected so the caller can read what happened afterwards. The timeout is the caller's to
 * size to the slowest thing inside the command, which here is a person. On timeout the
 * process gets SIGTERM and, if it ignores that, SIGKILL shortly after.
 *
 * Same result shape as `run`, so callers can inspect either the same way.
 */
export function runStreaming(command, args, options = {}) {
  const { timeoutMs = 30_000, onLine = null, env = process.env } = options;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env });
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        stdout: "",
        stderr: String(error.message ?? error),
        spawnError: true,
        timedOut: false,
      });
      return;
    }

    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (settled === false) {
          child.kill("SIGKILL");
        }
      }, 2_000).unref();
    }, timeoutMs);

    // Line-buffered per stream so a chunk boundary in the middle of a URL does not hand the
    // caller half of it.
    const watch = (stream, stash) => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        stash.push(chunk);
        pending += chunk;
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, "");
          pending = pending.slice(newline + 1);
          if (onLine !== null && line.trim() !== "") {
            onLine(line);
          }
          newline = pending.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (onLine !== null && pending.trim() !== "") {
          onLine(pending.replace(/\r$/, ""));
        }
      });
    };

    const outChunks = [];
    const errChunks = [];
    watch(child.stdout, outChunks);
    watch(child.stderr, errChunks);

    const finish = (result) => {
      if (settled === true) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: outChunks.join(""),
        stderr: result.stderr ?? errChunks.join(""),
      });
    };

    child.on("error", (error) => {
      finish({
        ok: false,
        status: null,
        stderr: String(error.message ?? error),
        spawnError: true,
        timedOut: false,
      });
    });

    child.on("close", (status) => {
      finish({
        ok: status === 0 && timedOut === false,
        status,
        spawnError: false,
        timedOut,
      });
    });
  });
}

/** A shell-ready rendering of a command, for printing a step the user has to run by hand. */
export function formatCommand(command, args) {
  const parts = [command, ...args].map((part) =>
    /[\s"'$`\\]/.test(part) === true ? JSON.stringify(part) : part,
  );
  return parts.join(" ");
}
