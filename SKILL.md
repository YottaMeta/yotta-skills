---
name: yotta-skills
version: 0.1.1
description: 元阁 —— 全家技能一键安装 CLI：一条命令把 YottaMeta 已发布的全部 yotta-* 技能（当前 22 个）装进指定智能体或目录；支持 --list 清单 / install / update / --dry-run 预览 / --pin 锁版本；幂等、零依赖（Node.js 18+）、纯 npm 生态，不内置任何技能本体。触发：需要批量安装或更新元阁全家技能、给某个智能体或目录一次性铺齐 yotta-* 技能、预览安装清单、锁版本安装时；或用户说 元阁/装全家/一次装齐/yotta-skills/install-all/更新全家 等。边界（Do NOT trigger）：只做「清单 + 下载 + 落位 + 汇总」，不含技能本体、不做技能内容开发、不 -g 污染全局；装前摘要仅供参考，安装决策由用户确认。
license: MIT
metadata:
  zh_name: 元阁
---

# 元阁（yotta-skills）

**全家技能一键安装 CLI**：一条 `npx -y @yottameta/yotta-skills` 把元阁已发布的全部
`yotta-*` 技能（当前 22 个）装进指定智能体默认目录或任意目录——`--list` 看清单、
`install` 一次装齐、`update` 增量更新、`--dry-run` 先预览、`--pin` 锁版本。

每个技能仍走各自独立的 npm 包（版本源唯一）；本包只做「清单 + 下载 + 落位 + 汇总」，
**不内置任何技能本体**，体积极小。运行依赖仅 Node.js 18+ / npm / 系统 tar。
> **与单个技能安装不同**：元阁是「全家安装器」，本身不含任何技能本体。把它拿到手只代表你有了安装工具；要真正装齐全家，需运行 `install` 把 22 个技能从各自 npm 包装进目标目录。


## 何时使用

- 新装一个智能体（如 Codex / Claude Code / Cursor），想一次把元阁全家技能铺到位；
- 给某个目录或智能体批量安装 / 更新 `yotta-*` 技能；
- 安装前先预览会装哪些技能、什么版本；
- 需要锁死清单版本、或强制重装。

**Do NOT trigger**：

- 本工具不做技能内容开发与审查，也不包含任何技能本体；
- 装前摘要（元信 yotta-verify）仅供参考，不替代人工安装决策；
- 不使用 `-g` 全局安装，不向未指定的位置写文件；
- 网络不可用时安装会失败并给出明确错误，不伪造结果。

## 快速使用

```bash
# 列出全家技能 + 版本 + 说明
npx -y @yottameta/yotta-skills --list

# 装全家到指定智能体默认用户级目录（推荐）
npx -y @yottameta/yotta-skills install --agent codex

# 装全家到任意目录（每个技能落在 <dir>/<slug>）
npx -y @yottameta/yotta-skills install --dir ~/my-skills

# 只装单个 / 多个技能
npx -y @yottameta/yotta-skills install yotta-memory yotta-verify --dir ~/my-skills

# 增量更新已装技能（补齐缺失 / 版本不一致）
npx -y @yottameta/yotta-skills update --agent codex

# 预览将安装清单（不联网、不改动）
npx -y @yottameta/yotta-skills --dry-run
```

## 命令与选项

| 命令 / 选项 | 作用 |
|---|---|
| `--list`（`-l`） | 列出全家技能 + 版本 + 说明；可加技能名过滤 |
| `install --agent <name>` | 装全家到指定智能体默认用户级目录（推荐） |
| `install --dir <path>` | 装全家到指定目录，每个技能落在 `<path>/<slug>` |
| `install <skill>... [--agent <name> \| --dir <path>]` | 只装指定的一个或多个技能 |
| `update [--agent <name> \| --dir <path>]` | 增量更新：补齐缺失技能、升级版本不一致的技能 |
| `--dry-run` | 预览将执行的安装 / 更新清单；不联网、不改动 |
| `--pin` | 锁死清单精确版本（默认 range：跟随同 major 最新 patch） |
| `--force` | 已是最新也重新安装 |
| `--skip-scan` | 跳过元信装前摘要（装了 yotta-verify 时默认自动启用） |
| `--npm <path>` | 指定 npm 可执行文件 |
| `--python <path>` | 指定 python 可执行文件（元信摘要用） |
| `--verify <path>` | 指定 yotta_verify.py 路径 |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

不带命令直接给技能名时，等价于 `install <skill>`。

## 版本策略

- 默认 `range`：按清单 `major.x` 取 npm 最新 patch（如 `0.x`），维护性更新随最新；
- `--pin`：锁死清单中的精确版本，完全可复现；
- 是否「已是最新」由目标目录 `<slug>/SKILL.md` 的 frontmatter `version` 与清单比对，
  一致即跳过（幂等）。

## 元信装前摘要

安装时若检测到元信（yotta-verify）引擎，会对每个待装技能先跑一次装前摘要并打印 verdict
与计数——仅提示、不拦截；verdict 为 DO NOT INSTALL 时会额外提示人工复核。
引擎查找顺序：`--verify` 指定路径 → 环境变量 `YOTTA_SKILLS_VERIFY` → 目标目录下已装的
`yotta-verify/scripts/yotta_verify.py`。可用 `--skip-scan` 关闭。

## 支持智能体

17 个内置键名：`claude` `cursor` `codex` `gemini` `goose` `amp` `opencode` `windsurf`
`workbuddy` `kiro` `trae` `trae-cn` `qwen` `comate` `codebuddy` `kimi` `agents`。
未收录的智能体请用 `--dir` 指定其技能目录（`.agents/skills` 不是通用目录）。

## 环境变量

| 变量 | 作用 |
|---|---|
| `YOTTA_SKILLS_NPM` | 指定 npm 可执行文件（同 `--npm`） |
| `YOTTA_SKILLS_NPM_FLAGS` | 追加传给 `npm pack` 的参数（按空白拆分，如 `--registry=...`） |
| `YOTTA_SKILLS_PYTHON` | 指定 python 可执行文件（元信摘要用，同 `--python`） |
| `YOTTA_SKILLS_VERIFY` | 指定 yotta_verify.py 路径（同 `--verify`） |
| `YOTTA_SKILLS_MANIFEST` | 指定技能清单 JSON 路径（默认随包 skills.json） |

## 常见问题

- **npmmirror 全新包 404**：镜像同步有延迟，通过 `YOTTA_SKILLS_NPM_FLAGS` 追加
  `--registry=https://registry.npmjs.org/`（国内需代理）或等待镜像缓存后重试。
- **未收录智能体**：`--agent <name>` 报未收录时，改用 `--dir` 指到它的技能目录。
- **Windows 下 npm 报错**：CLI 已内置 npm-cli.js 解析，无需额外处理；如需覆盖用 `--npm`。
- **某技能安装失败**：汇总报告会列出失败原因，可单装该技能排查。

## 参考

- 全家技能清单（人工可读版）：`references/skill-list.md`（机器权威源为 `skills.json`）。
- 内部机制：`references/install-flow.md`。
- 新手中文教程：`references/tutorial.md`。
