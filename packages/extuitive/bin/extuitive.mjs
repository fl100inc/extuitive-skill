#!/usr/bin/env node
/**
 * `npx extuitive install | update | uninstall | doctor`
 *
 * The whole launcher. It exists so the command is `extuitive` and not `@extuitive/skill`;
 * everything else lives in that package. Its CLI runs on import and reads
 * `process.argv.slice(2)`, which is the same slice whether node was handed this file or
 * that one, so there is nothing to forward.
 */
await import("@extuitive/skill/bin/cli.mjs");
