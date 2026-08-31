<p align="center"><b>Language</b>: <a href="./README.md">English</a> · 中文</p>

<p align="center">
  <img src="assets/banner.png" alt="yotta-skills banner" width="100%" />
</p>

<h1 align="center">yotta-skills · 元阁 (YuanGe)</h1>

<p align="center">YottaMeta 的<b>技能生态编排路由 + 全家一键安装器 + 技能盘点</b>：先按需求路由该组合哪几个技能，再一条 <code>npx</code> 命令把已发布的全部
<code>yotta-*</code> 技能（当前 <b>22</b> 个）装进指定智能体或目录。</p>
<p align="center">看清单、路由组合、装全家、增量更新、<code>--dry-run</code> 预览、<code>--pin</code> 锁版本--
幂等、零依赖（Node.js 18+）、纯 npm 生态。</p>
<p align="center">本包<b>不含任何技能本体</b>——只做「清单 + 下载 + 落位 + 汇总」；每个技能仍走各自 npm 包。</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://agentskills.io/"><img alt="Standard: agentskills.io" src="https://img.shields.io/badge/standard-agentskills.io-orange" /></a>
  <a href="https://www.npmjs.com/package/@yottameta/yotta-skills"><img alt="npm package" src="https://img.shields.io/npm/v/@yottameta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills"><img alt="GitHub stars" src="https://img.shields.io/github/stars/YottaMeta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills/commits/main"><img alt="last commit" src="https://img.shields.io/github/last-commit/YottaMeta/yotta-skills" /></a>
  <a href="https://github.com/YottaMeta/yotta-skills"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen" /></a>
</p>

## 这是什么

以前装元阁全家要逐个 <code>npx</code> 跑很多次。元阁把它变成一条命令：读内置清单（22 个已发布技能）、
逐个从各自 npm 包下载、落位到目标技能目录、打印汇总（成功 / 跳过 / 失败）。

元阁也是全家的**编排策划层**：接到需求先查「编排策划」组合表——该组合哪几个技能、按什么顺序、各自强在哪——再按需安装恰好那几个。决策表随包提供（<code>references/orchestration.md</code>），<code>SKILL.md</code> 中有摘要。

- **看清单**--全家技能一览：slug / 中文名 / 包名 / 版本 / 一句话说明。
- **编排路由**--`--route` 按需求摘要输出候选组合、调用顺序、技能角色、置信度、依据、已装/缺失状态与安装命令；非元阁家族已装技能按 frontmatter description 机械匹配作并列候选（标注来源与未扫描状态，只读不自动调用）；只建议安装，不自动安装。
- **安装**——装全家（或指定技能）到智能体默认用户级目录或任意目录。
- **更新**——增量更新：补齐缺失技能、升级版本不一致的技能。
- **幂等**——已在清单版本的技能跳过；重复运行安全。
- **装前摘要**——若装了元信（yotta-verify），先对每个待装技能做一次装前扫描；verdict 仅提示、不拦截。
- **盘点 / re-index**--扫描本机各智能体技能目录，维护本地注册表（<code>~/.yottaskills/registry.json</code>）；自包含，不需要任何其他技能。新装技能自动被发现：<code>install</code> / <code>update</code> 完成后自动重扫注册表，<code>--reindex</code> 可随时手动重扫（如会话开工）。可选 <code>yotta-skills</code> MCP（按需加载、不常驻）提供 <code>list_installed_skills</code> / <code>describe_skill</code> / <code>reindex</code> / <code>route_request</code> 四工具，配置见 <code>SKILL.md</code>。

边界：只做「下载 + 落位 + 汇总」——**不**开发技能内容、**不**内置任何技能本体、**不**用 <code>-g</code>
全局安装；只在你指定的目标内写文件。

## 快速使用

```bash
# 列出全家技能（不联网、不改动）
npx -y @yottameta/yotta-skills --list

# 装全家到指定智能体默认用户级技能目录（推荐）
npx -y @yottameta/yotta-skills install --agent codex

# 装全家到任意目录（每个技能落在 <dir>/<slug>）
npx -y @yottameta/yotta-skills install --dir ~/my-skills

# 只装个别技能
npx -y @yottameta/yotta-skills install yotta-memory yotta-verify --dir ~/my-skills

# 增量更新已装技能
npx -y @yottameta/yotta-skills update --agent codex

# 预览将安装清单（不联网、不改动）
npx -y @yottameta/yotta-skills --dry-run

# 按需求摘要给出组合、顺序与缺失技能安装建议
npx -y @yottameta/yotta-skills --route "检查代码质量，别糊弄"

# 盘点本机已装技能（自包含扫描，不依赖任何元技能）
npx -y @yottameta/yotta-skills --inventory

# 重扫注册表（会话开工 / 新装技能后，增量合并变化）
npx -y @yottameta/yotta-skills --reindex
```

前置：Node.js 18+、npm、系统 tar（Windows 10+ / macOS / 多数 Linux 自带）。

## 命令与选项

| 命令 / 选项 | 作用 |
|---|---|
| `--list`（`-l`） | 列出全家技能 + 版本 + 说明；可加技能名过滤 |
| `install --agent <name>` | 装全家到指定智能体默认用户级技能目录（推荐） |
| `install --dir <path>` | 装全家到指定目录，每个技能落在 `<path>/<slug>` |
| `install <skill>... [--agent <name> \| --dir <path>]` | 只装指定的一个或多个技能 |
| `update [--agent <name> \| --dir <path>]` | 增量更新：补齐缺失、升级版本不一致的技能 |
| `--inventory` | 盘点已装技能：扫描技能目录并更新本地注册表（自包含）；`--json` 输出 JSON、`--project` 附扫项目级目录 |
| `--reindex` | 重扫注册表：扫描技能目录并增量合并变化（会话开工 / 装技能后自动调用；`--rescan` 同义）；`--json` 输出 JSON |
| `--route <需求摘要>` | 静态编排路由：输出组合、调用顺序、技能角色、置信度、依据、已装/缺失状态与安装建议；`--json` 输出 JSON、`--project` 附扫项目级目录 |
| `--no-reindex` | 安装 / 更新后不自动重扫注册表 |
| `--dry-run` | 预览将执行的安装 / 更新清单；不联网、不改动 |
| `--pin` | 锁死清单精确版本（默认 range：跟随同 major 最新 patch） |
| `--force` | 已是最新也重新安装 |
| `--skip-scan` | 跳过元信装前摘要（装了 yotta-verify 时默认自动启用） |
| `--npm <path>` | 指定 npm 可执行文件 |
| `--python <path>` | 指定 python 可执行文件（元信摘要用） |
| `--verify <path>` | 指定 yotta_verify.py 路径 |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

不带命令直接给技能名时，等价于 `install <skill>`。

支持 17 个智能体键名：`claude` `cursor` `codex` `gemini` `goose` `amp` `opencode` `windsurf`
`workbuddy` `kiro` `trae` `trae-cn` `qwen` `comate` `codebuddy` `kimi` `agents`。
未收录的智能体请用 `--dir` 指到它的技能目录（`.agents/skills` 不是通用目录）。

## 版本策略

- 默认 `range`：`npm pack <pkg>@<major>.x`——取清单同 major 的最新 patch，维护性更新随最新；
- `--pin`：锁死清单精确版本，完全可复现；
- 是否「已是最新」由目标 `<dir>/<slug>/SKILL.md` 的 frontmatter `version` 与清单比对，一致即跳过。

## 安装

> **先分清两层**：`yotta-skills`（元阁）是「全家技能安装器」，本身**不含任何技能本体**。它所做的事是把已发布的 22 个 `yotta-*` 技能从各自 npm 包装进目标目录，所以「拿到元阁」不等于「已装齐技能」——拿到后还需运行一次 `install`，才会把全家真正放进目标目录。单个技能（如 `@yottameta/yotta-memory`）是各自独立的 npm 包、装自己即可；元阁是「一次装齐全家」的管理器，安装方式与此不同。

下面四种方式任选，顺序即推荐优先级；本包一律从 **npm** 获取（GitHub 无代理较慢，npm 支持镜像）。方式二 / 三只「拿到安装器」；方式四只把「安装器技能」本身装进智能体目录——都仍需再跑一次 `install` 才装齐全家。

### 方式一：npm 一行装（推荐）

```text
# 可选国内加速：npm config set registry https://registry.npmmirror.com
npx -y @yottameta/yotta-skills install --agent <智能体名称>      # 装全家到指定智能体默认用户级技能目录
npx -y @yottameta/yotta-skills install --dir <你的技能目录>     # 装全家到指定目录（如 ~/.codex/skills）
```

- `npx` 会自动拉取最新版 `yotta-skills`，无需单独安装步骤；这是唯一「拿到安装器 + 装齐全家」一步到位的方式。
- `--agent <name>` 自动装到该智能体默认用户级目录；`--list` 可查看各智能体默认目录。
- `--dir <路径>` 装到指定的技能目录；未收录的智能体用 `--dir` 指到它的技能目录。
- npmmirror 未同步新包（404）：加 `--registry=https://registry.npmjs.org/`（国内需代理），或稍等镜像缓存。

### 方式二：git clone（开发者 / 有 git 环境）

```text
git clone https://github.com/YottaMeta/yotta-skills.git <你的技能目录>/yotta-skills
cd <你的技能目录>/yotta-skills
node bin/yotta-skills.js install --dir <你的技能目录>
```

- 克隆只拿到**安装器**；`--list` 只会打印清单、不安装任何东西。跑 `install` 才会把全家装进目标目录。

### 方式三：GitHub 下载压缩包（手动 / 无 git 环境）

在 GitHub 仓库 `YottaMeta/yotta-skills` 点 **Code → Download ZIP**，解压后跑 `node bin/yotta-skills.js install --dir <你的技能目录>` 装齐全家。把 `yotta-skills` 文件夹放进智能体技能目录只让**安装器技能**本身可被调用（它有自己的 `SKILL.md`），并不会把 22 个技能一并带进去——那仍需跑 `install`。

### 方式四：install.sh（多智能体一键脚本）

```text
bash install.sh --agent <name>   # 把「安装器技能」本身装到指定智能体默认用户级目录
bash install.sh --dir <path>     # 把「安装器技能」本身装到指定目录
bash install.sh --list           # 列出智能体 -> 默认目录
```

- `install.sh` 把「元阁安装器技能」本身装进智能体 / 目录，让代理能调用元阁；要装齐 22 个技能，再执行 `node bin/yotta-skills.js install --agent <name>`（或 `--dir <path>`）。

> 方式一走 npm 源（npmmirror / npmjs），不依赖 GitHub；方式二 / 三走 GitHub，国内无代理可能失败。

## 全家技能清单

22 个技能的 slug / 中文名 / 包名 / 版本 / 说明见 `references/skill-list.md`（机器权威源为
`skills.json`）。家族分布：安全与护栏（12）/ 质量与工程（4）/ 记忆与上下文（3）/ 写作与表达（1）/
工作流（1）/ 入口与引导（1）。

## 工作原理

对清单里每个技能：`npm pack <pkg>@<spec>` 到临时目录 → `tar -xzf` 解压 → 可选元信装前摘要 →
替换 `<dest>/<slug>` → 汇总报告。`install` / `update` 完成后自动重扫本地技能注册表，
新装技能随即出现在 `--inventory` / `--reindex` 里（可用 `--no-reindex` 关闭）。
细节见 `references/install-flow.md`；新手中文教程见 `references/tutorial.md`。

## 开发与校验

```bash
# 在技能目录内跑测试
npm test
```

测试覆盖 `--list`、临时目录安装断言、幂等、`--pin`、`update`、异常路径与元信 scan 集成
（用 fake npm 不联网）。

## 许可证

MIT © YottaMeta —— 见 [LICENSE](./LICENSE)。
