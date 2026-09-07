# extuitive

Installs the [Extuitive](https://extuitive.com) agent skill into Claude Code, Codex, or
Claude Desktop and connects it to the Extuitive MCP server.

```bash
npx extuitive install
```

Then, in your agent, say **"Check my Extuitive connection"** to sign in.

Other commands:

```bash
npx extuitive install --host codex --yes   # no prompts; --host claude | codex | claude-desktop | all
npx extuitive doctor                       # check what is installed and connected
npx extuitive update                       # refresh the skill in place
npx extuitive uninstall                    # remove it, keeping backups
```

This package is the command only. The skill and installer are in
[`@extuitive/skill`](https://www.npmjs.com/package/@extuitive/skill), which it depends on.
Full documentation, including what gets installed where and how to talk to the skill from each
host, is in the [repository README](https://github.com/fl100inc/extuitive-skill#readme).

MIT licensed.
