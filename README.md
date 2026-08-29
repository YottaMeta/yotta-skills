<p align="center"><b>Language</b>: English · <a href="./README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="assets/banner.png" alt="yotta-skills banner" width="100%" />
</p>

<h1 align="center">yotta-skills · 元阁 (YuanGe)</h1>

<p align="center">YottaMeta's <b>one-command family installer</b> for Agent skills: one <code>npx</code> line installs all published <code>yotta-*</code> skills (currently <b>22</b>) into any agent or directory.</p>
<p align="center">List the family, install everything, incrementally update, preview with <code>--dry-run</code>, pin exact versions — idempotent and zero-dependency (Node.js 18+), pure npm ecosystem.</p>
<p align="center">This package contains <b>no skill bodies</b> — only a manifest, a downloader, a placer and a summary. Each skill still comes from its own npm package.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://agentskills.io/"><img alt="Standard: agentskills.io" src="https://img.shields.io/badge/standard-agentskills.io-orange" /></a>
  <a href="https://www.npmjs.com/package/@yottameta/yotta-skills"><img alt="npm package" src="https://img.shields.io/npm/v/@yottameta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills"><img alt="GitHub stars" src="https://img.shields.io/github/stars/YottaMeta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills/commits/main"><img alt="last commit" src="https://img.shields.io/github/last-commit/YottaMeta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen" /></a>
</p>

## What it is

Installing the whole YottaMeta family used to mean running <code>npx</code> for each skill one by one. 元阁 turns it into a single command: it reads a built-in manifest (22 published skills), downloads each from its own npm package, places it into the target skills directory, and prints a summary (success / skipped / failed).

- **List** — see the whole family: slug, Chinese name, package, version and a one-line description.
- **Install** — install everything (or a subset) into an agent's default user-level directory or any directory.
- **Update** — incremental update: add missing skills, upgrade version-skewed ones.
- **Idempotent** — a skill already at the manifest version is skipped; re-running is safe.
- **Pre-install summary** — if yotta-verify (元信) is available, each skill is scanned first; the verdict is informational only.

Boundaries: it only downloads, places and summarizes — it does **not** develop skill content, does **not** bundle any skill body, and does **not** use <code>-g</code> global installs. It never writes outside the target you specify.

## Quick start

```bash
# List the whole family (no network, no changes)
npx -y @yottameta/yotta-skills --list

# Install everything into an agent's default user-level skills dir (recommended)
npx -y @yottameta/yotta-skills install --agent codex

# Install everything into any directory (each skill lands in <dir>/<slug>)
npx -y @yottameta/yotta-skills install --dir ~/my-skills

# Install only selected skills
npx -y @yottameta/yotta-skills install yotta-memory yotta-verify --dir ~/my-skills

# Incrementally update installed skills
npx -y @yottameta/yotta-skills update --agent codex

# Preview what would be installed (no network, no changes)
npx -y @yottameta/yotta-skills --dry-run
```

Requirements: Node.js 18+, npm, and system <code>tar</code> (built into Windows 10+ / macOS / most Linux distributions).

## Commands & options

| Command / option | Description |
|---|---|
| `--list` (`-l`) | List the whole family with versions and descriptions; add a skill name to filter |
| `install --agent <name>` | Install everything into the agent's default user-level skills dir (recommended) |
| `install --dir <path>` | Install everything into a directory; each skill lands in `<path>/<slug>` |
| `install <skill>... [--agent <name> \| --dir <path>]` | Install only the given skills |
| `update [--agent <name> \| --dir <path>]` | Incremental update: add missing, upgrade version-skewed |
| `--dry-run` | Preview the install / update list; no network, no changes |
| `--pin` | Lock the exact manifest versions (default: range, latest patch of the same major) |
| `--force` | Reinstall even when already at the latest version |
| `--skip-scan` | Skip the yotta-verify pre-install summary (auto-enabled when yotta-verify is installed) |
| `--npm <path>` | Specify the npm executable |
| `--python <path>` | Specify the python executable (used for the yotta-verify summary) |
| `--verify <path>` | Specify the yotta_verify.py path |
| `-h, --help` / `-v, --version` | Help / version |

Calling `npx -y @yottameta/yotta-skills <skill>` without a subcommand is equivalent to `install <skill>`.

Supported agent keys (17): `claude` `cursor` `codex` `gemini` `goose` `amp` `opencode` `windsurf` `workbuddy` `kiro` `trae` `trae-cn` `qwen` `comate` `codebuddy` `kimi` `agents`. For agents not in the preset list, point `--dir` at their skills directory (`.agents/skills` is not a universal directory).

## Version strategy

- Default `range`: `npm pack <pkg>@<major>.x` — the latest patch of the same major in the manifest, so maintenance releases are picked up automatically.
- `--pin`: exact manifest versions, fully reproducible.
- "Already at the latest" is determined by comparing the frontmatter `version` in `<dir>/<slug>/SKILL.md` with the manifest; matching versions are skipped.

## Installation

> **Two layers first**: `yotta-skills` (元阁) is a **family installer**, not a skill itself — it ships no skill bodies. It pulls each of the 22 published `yotta-*` skills from its own npm package into your target directory, so **getting 元阁 is not the same as having the skills**. After you have the installer, run `install` once to actually place the whole family. A single skill (e.g. `@yottameta/yotta-memory`) is its own npm package and installs by itself; 元阁 is the **install everything at once** manager, so its install path is different.

Pick any of the four methods below; the order is the recommended priority. The package always comes from **npm** (GitHub can be slow without a proxy; npm supports mirrors). Methods 2/3 only fetch the **installer**; method 4 places only the **installer skill** into an agent's skills directory — in each case you still run `install` to bring the whole family.

### Method 1: npm one-liner (recommended)

```text
# Optional China mirror: npm config set registry https://registry.npmmirror.com
npx -y @yottameta/yotta-skills install --agent <agent-name>      # install the whole family to the agent's default user-level skills dir
npx -y @yottameta/yotta-skills install --dir <your-skills-dir>   # install the whole family to a directory (e.g. ~/.codex/skills)
```

- `npx` fetches the latest `yotta-skills` automatically, so there is no separate installation step; this is the only method that both gets the installer and installs the family in one command.
- `--agent <name>` installs to that agent's default user-level directory; `--list` shows each agent's default directory.
- `--dir <path>` installs to the given directory; for agents not in the preset list, point `--dir` at their skills directory.
- If the mirror has not synced the new package (404): add `--registry=https://registry.npmjs.org/` (a proxy may be needed in China), or wait for the mirror cache.

### Method 2: git clone (developers / git available)

```text
git clone https://github.com/YottaMeta/yotta-skills.git <your-skills-dir>/yotta-skills
cd <your-skills-dir>/yotta-skills
node bin/yotta-skills.js install --dir <your-skills-dir>
```

- Cloning only fetches the **installer**; `--list` only prints the manifest and installs nothing. Run `install` to place the whole family into the target directory.

### Method 3: GitHub Download ZIP (manual / no git)

On the GitHub repository `YottaMeta/yotta-skills`, click **Code → Download ZIP**, unzip it, then run `node bin/yotta-skills.js install --dir <your-skills-dir>`. Copying the `yotta-skills` folder into an agent's skills directory only makes the **installer skill** itself callable (it has its own `SKILL.md`) — it does not bring the 22 skills; run `install` for that.

### Method 4: install.sh (multi-agent one-liner script)

```text
bash install.sh --agent <name>   # install the master installer skill to the agent's default user-level directory
bash install.sh --dir <path>     # install the master installer skill to the given directory
bash install.sh --list           # list agents -> default directories
```

- `install.sh` places the **元阁 installer skill** itself so an agent can invoke the family installer. To install the 22 skills, run `node bin/yotta-skills.js install --agent <name>` (or `--dir <path>`).

> Method 1 uses the npm registry (npmmirror / npmjs) and does not depend on GitHub; Methods 2/3 use GitHub and may fail without a proxy in China.

## Included skills

The full 22-skill manifest with Chinese names, package names, versions and descriptions is in `references/skill-list.md` (the machine-readable source is `skills.json`). Family coverage: Security & Guardrails (12), Quality & Engineering (4), Memory & Context (3), Writing & Expression (1), Workflow (1), Entry & Guidance (1).

## How it works

For each skill in the manifest: `npm pack <pkg>@<spec>` into a temp directory → `tar -xzf` → optional yotta-verify pre-install summary → replace `<dest>/<slug>` → summary report. Details: `references/install-flow.md`; beginner tutorial (Chinese): `references/tutorial.md`.

## Development & validation

```bash
# Run the test suite (12 cases) from the skill directory
npm test
```

The tests cover `--list`, install into a temp directory with assertions, idempotency, `--pin`, `update`, error paths, and yotta-verify scan integration (with a fake npm).

## License

MIT © YottaMeta — see [LICENSE](./LICENSE).
