## v0.19.20 (2026-09-25)

**清单同步：元忆 0.17.0 + 信任层四件 + 元公 0.1.2**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.7 → 0.17.0；清单更新日期 → 2026-09-25。
- 补记信任层四件（元规 0.1.0 / 元镜 0.1.0 / 元案 0.1.0 / 元题 0.1.0）与元公 0.1.2，人工可读清单从 22 技能补齐到 27 技能，并补「合规与信任」「教育与学习」两个家族分区。
- 修正 `skill-list.md` 与 `skills.json` 的技能集合 / 版本一致性回归；`--list`、install、install 幂等、update 的测试计数改为读取清单长度，后续新增技能不再硬编码数量。
- 版本对齐：package.json / SKILL.md frontmatter / skill-manifest.json / 引擎 VERSION / MCP VERSION / CHANGELOG = 0.19.20。

## v0.19.19 (2026-09-23)

**清单同步：元忆 0.16.7（迁移口令安全 + view 根指纹）**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.6 → 0.16.7。
- 同步元忆迁移文档的编码安全修正，以及 `view` 端口复用前的 memory_home 指纹校验。
- 版本对齐：package.json / SKILL.md frontmatter / skill-manifest.json / 引擎 VERSION / CHANGELOG = 0.19.19。

## v0.19.18 (2026-09-23)

**插件载荷完整性修复：lib/ + skills.json**

- `tools/build_standalone_plugins.py` 的 `PAYLOAD_DIRS` 补 `lib`，插件载荷含元阁 12 个运行时模块；新增 `PAYLOAD_EXTRA_FILES` 把 `skills.json` 带入载荷。
- 修复插件内 `reindex` / `route_request` 报 `Cannot find module '../lib/install-evidence'` 与清单读取失败。
- 新增回归 `tools/test_plugin_payload_runtime.py`：构建后插件载荷必须跑通 reindex + route_request。
- 清单同步元忆 0.16.6；版本对齐 package.json / SKILL.md frontmatter / skill-manifest.json / 引擎 VERSION / CHANGELOG = 0.19.18。

## v0.19.17 (2026-09-22)

**清单同步：元忆 0.16.5（doctor JSON 稳定契约）**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.4 → 0.16.5。
- 同步 `doctor --json` 顶层 `schemaVersion` / `encryption` / `migration_required` 契约，确保全家安装取得正确版本。
- 版本对齐：package.json / SKILL.md frontmatter / skill-manifest.json / 引擎 VERSION / CHANGELOG = 0.19.17。

## v0.19.16 (2026-09-22)

**清单同步：元忆 0.16.4（agent-key 提示范围修复）**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.3 → 0.16.4，清单更新日期 → 2026-09-22。
- 同步元忆缺 `--agent-key-file` 的提示范围修复，确保全家安装按清单取得正确版本。
- 版本对齐：package.json / SKILL.md frontmatter / skill-manifest.json / 引擎 VERSION / CHANGELOG = 0.19.16。

## v0.19.15 (2026-09-22)

**清单同步：元忆 0.16.3（迁移授权最短路径）**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.2 → 0.16.3，`updated` → 2026-09-22。
- 同步内容：明文库迁移最短命令、`view` / `key bind` 授权等价口径、CLI 帮助与技能文档统一。
- 安装器 / 路由 / hook 契约零变更；本版仅为清单与版本同步。

## v0.19.14 (2026-09-21)

**清单同步：元忆 0.16.2（首启修复）**

- `skills.json` / `references/skill-list.md` 的 yotta-memory 版本 0.16.1 → 0.16.2，`updated` → 2026-09-21。
- 同步内容：元忆 0.16.2 首启修复——空加密库 `view` 恢复钥匙解锁、非 TTY `--password-stdin`、`--recovery-key-out`、缺 `agent-key` 降级未授权、空明文 `migrate`、doctor 分档与 `view` 端口健康检查。
- 安装器 / 路由 / hook 契约零变更；本版仅为清单与版本同步。

## v0.19.13 (2026-09-19)

**安全修复：校验器（元信）发现改为「受信安装记录 + 身份 + 摘要」三重绑定。**

- 背景（平台扫描发现，T07 工具劫持）：旧实现通过本地技能注册表里 `slug=yotta-verify` 的
  `source_dirs` 发现扫描引擎，而注册表身份来自被扫描技能自己 `SKILL.md` frontmatter 的 `name`。
  任意目录只要自称 `yotta-verify` 并提供 `scripts/yotta_verify.py`，就会被当作引擎执行——
  既可直接执行任意代码，也能伪造 `SAFE TO INSTALL` 放行后续安装。
- 修复：
  - 新增 `lib/trusted-verifier.js`：受信记录 `~/.yottaskills/trusted-verifier.json`
    （与注册表同目录，支持 `YOTTA_SKILLS_REGISTRY_FILE` 多 agent 隔离），只在安装管线
    校验通过、元信安装 / 更新成功后写入。
  - `findVerifier` 只认两类来源：用户显式指定（`--verify` / `YOTTA_SKILLS_VERIFY`）与
    受信记录；候选须通过「路径 realpath 无符号链接跳转 + 包身份（slug / package / trust /
    SKILL.md 与 manifest 版本一致）+ 引擎 SHA-256 与记录一致」。
  - 任一环节不满足即 fail-closed：不再回退到注册表 / 目标目录里的同名引擎，改走自举安装
    （从 npm 重装一份干净的元信，装完立即写记录）。
  - 自举安装后新增身份 / 摘要复核，未通过不返回引擎。
- 测试：新增 `test/trusted-verifier.test.js` 8 项（含 T07 回归、摘要不符、身份不符、版本不符、
  裸引擎不被采用、记录读写往返）；测试夹具 `test/helpers/fake-npm.js` 按真实元信包形态
  生成 manifest；`node --test "test/*.test.js"` 180/180。
- 清单同步：`skills.json` 元信 0.3.1 → 0.3.2（`references/skill-list.md` 同步）。

## v0.19.12 (2026-09-19)

同步家族维护批次清单版本：元安全 0.2.6 / 元盾 0.1.4 / 元察 0.2.9 / 元析 0.1.7 / 元安 0.2.4 / 元审 0.2.5。

## v0.19.11 (2026-09-19)

**OpenClaw / QClaw 目录识别 + 清单同步**

- `--inventory` / `--reindex` 等盘点能力新增识别 OpenClaw / QClaw 技能目录（`~/.openclaw/skills`，支持 `OPENCLAW_STATE_DIR` 覆盖）——QClaw 基于 OpenClaw，同一目录下的技能现在可被盘点、去重与路由覆盖；新增 `test/skills-scan.test.js` 用例。
- 清单同步：`skills.json` 与 `references/skill-list.md` 更新元真 `0.2.1`（位置参数修复）与元忆 `0.16.1`（维护性重发）。

## v0.19.10 (2026-09-19)

**台账口径维护**

- `references/skill-list.md` 元忆行由 `0.15.0` 更正为 `0.16.0`，清单更新日期改为 `2026-09-19`；`skills.json` 为机器权威源，`test/skill-list.test.js` 强制两者一致。
- 更正 v0.19.7 条目表述：元伴 `yotta-partner` 不在全家清单内（`skills.json` 与 `skill-list.md` 均未收录该技能，元伴通过自带安装器单独安装）。
- 本次只维护清单口径与文档表述，不改变安装器、路由、hook 契约与清单技能集合（仍为 22 项）。

## v0.19.9 (2026-09-18)

- 同步元链 `0.1.4` 到 skills.json / skill-list：新增 `scannedFiles` 扫描输入证据，统一 stdout / stderr UTF-8。
- 不改变安装器、路由与 hook 契约。

## v0.19.8 (2026-09-17)

- 同步 O6 候选清单：元链 0.1.3 / 元守 0.4.2 / 元引 0.2.2 / 元习 0.2.1 / 元测 0.3.1 / 元鉴 0.1.3。
- 不改变安装器、路由与 hook 契约；版本四件与 OpenCode 锁文件统一更新。

## v0.19.7 (2026-09-17)

**MCP registry 按 agent 隔离**

- 新增 `YOTTA_SKILLS_REGISTRY_FILE`：CLI 与 MCP 统一读取该环境变量，允许为不同 agent 指定独立 `registry.json`；未设置时保持 `~/.yottaskills/registry.json`。
- MCP `list_installed_skills` / `reindex` 返回实际注册表路径，便于宿主核对隔离位置。
- OpenCode 锁文件将配置 `<dataDir>/yottaskills/<agentId>/registry.json`，避免多 agent 共用同一注册表。
- `install.sh --dir` 改为只安装技能本体与 MCP / 清单资产，清理旧的 `.github`、`bin`、`lib`、`test`、`package.json` 等开发文件；新增自用安装回归。
- 同步清单中的元质 `0.4.1`、元伴 `0.2.1`、元引 `0.2.1` 与元忆 `0.15.0` 候选版本。
- 本里程碑只隔离 registry；安装快照、安装证据、更新缓存和 hook 绑定仍保持现有用户级位置。

## v0.19.6 (2026-09-16)

- 清单同步：yotta-memory 0.13.2（调用者认证 / agent_key 绑定安全修复）。
- 更新 `skills.json` / `references/skill-list.md` 的元忆版本与 updated 日期。
- 安装器版本四件对齐 0.19.6；本次不改变安装 / 路由算法。

## v0.19.5 (2026-09-15)

**多源技能盘点版本修复**：

- 同名技能多副本扫描新增 `variants` 明细，代表版本取合法版本中的最高 semver；版本差异持久化为 `conflicts`，不再由首个来源副本决定显示版本。
- `--inventory` / `--route` 显示代表版本与多副本摘要；`doctor` 优先按目标目录匹配精确副本版本，旧注册表缺少 `variants` 时回退聚合版本。
- 回归覆盖多副本 semver 选择、注册表幂等、CLI 文本/JSON 与 doctor 精确匹配；`npm test` 168/168。

## v0.19.4 (2026-09-14)

**元造 0.1.2 清单同步**：

- `skills.json` / `references/skill-list.md` 将 `yotta-skill-creator` 版本
  从 0.1.1 同步到 0.1.2，清单更新日期同步为 2026-09-14。
- 本次为清单同步版本，安装器、路由与 hook 逻辑无行为变更。

## v0.19.3 (2026-09-13)

**自装契约修复 + 扫描误报消除**：

- `skill-manifest.json` 的 `before_install` 声明由 `install_gate` 改为 `scan_skill`，与安装管线实际提供的检查项对齐；此前自装会被自己的 hook 判为 missing → block（只能 `--skip-scan` 绕过）。
- `permissions.note` 调整措辞，避免同时出现「下载 / 执行」触发元信 PIJ-020 误报（high）。
- 新增 `test/self-install-contract.test.js`：锁定「声明 = 管线检查项」「扫描通过放行 / 失败阻断」「note 不触发 PIJ-020」三条契约。

## v0.19.2 (2026-09-13)

**授权边界整改（平台安全评估反馈）**：

- SKILL.md「使用须知」由「首次使用必须写入宿主全局记忆」改为**可选步骤 + 显式确认**：写入前展示目标文件、完整文本与后果，用户拒绝则不写任何文件并保持 CLI 用法。
- 删除常驻授权表述：可选注入文本不再要求每个会话无条件重扫或代用户安装、调用其他技能；组合建议统一改为「先建议、经用户确认后安装与调用」。
- MCP 配置写入改为显式确认后落盘；用户拒绝或无法改配置时继续 CLI 降级。
- 安装版本策略默认改为 `--pin`（清单精确版本，可复现）；`--range` 为显式可选项，不再默认跟随浮动 patch。
- 同步 SKILL.md / README 中英 / FAQ / 教程 / 编排表 / install-flow / MCP server 说明；新增文档授权边界回归测试。

## v0.19.1 (2026-09-13)

- 文档去本机硬编码：Codex 永久记忆写入位置从本机绝对路径改为 `$CODEX_HOME/AGENTS.md`（未设置时 `~/.codex/AGENTS.md`）。
- 清理测试夹具中的本机路径；新增发布前机器路径硬编码扫描闸门后，此类问题不允许再进入发布件。

## v0.19.0 (2026-09-13)

**元守家族分类假阳性修复**：

- 元守 0.4.1 内置分类副本补入 `yotta-skills` 非安全家族排除，消除元阁 Defense Triple 假阳性。
- `skills.json` / `references/skill-list.md` 同步 yotta-publish-guard 0.4.1。

## v0.18.0 (2026-09-13)

**Advisory 仓库文档 hygiene 清理**：

- 元察 0.2.8 / 元析 0.1.6 / 元安 0.2.3 / 元造 0.1.1 / 元鉴 0.1.2 清理历史公开文档中的内部表述。
- 五个技能 preflight、validate、测试与 pack 全部通过。
- `skills.json` / `references/skill-list.md` 同步五个版本。

## v0.17.0 (2026-09-13)

**P0-6 全家族铺开覆盖验收**：

- 新增 26 技能 manifest 覆盖测试：全部技能必须能解析包内 manifest 或家族默认契约。
- 强制 8 技能必须提供包内 manifest 和 hook 声明；补齐 `yotta-verify-mcp` 与 `yotta-skills` 两个缺口。
- 版本与发布件同步 0.17.0。

## v0.16.0 (2026-09-13)

**P0-4.6 元忆 after_milestone 试点**：

- 元忆 manifest 声明 `after_milestone` / `remember_commit` / `fallback: explicit-unverified`。
- 元阁真实 manifest 回归验证：有记忆文件证据时 allow/verified；缺证据或写入失败时 `explicit-unverified` + 一次纠偏。
- `skills.json` / `references/skill-list.md` 同步 yotta-memory 0.13.0。

## v0.15.0 (2026-09-13)

**P0-4.5 元守 before_publish 试点**：

- 元守 manifest 声明 `before_publish` / `publish_gate` / `fallback: wrapper`。
- 元阁真实 manifest 回归验证：wrapper 已注册且门禁失败时 block；wrapper 未注册时 `explicit-unverified`。
- `skills.json` / `references/skill-list.md` 同步 yotta-publish-guard 0.4.0。

## v0.14.0 (2026-09-13)

**P0-4.4 元序 before_start / after_milestone 试点**：

- 元序 manifest 声明 `before_start` / `read_state` 与 `after_milestone` / `write_state`。
- 元阁真实 manifest 回归验证：有状态文件证据时 allow；缺证据或落盘失败时 `explicit-unverified` + 一次纠偏。
- `skills.json` / `references/skill-list.md` 同步 yotta-workflow 0.4.1。

## v0.13.0 (2026-09-13)

**P0-4.3 元盾 before_tool 试点**：

- 元盾 manifest 声明 `before_tool` / `guard_check` / `fallback: explicit-unverified`。
- 元阁真实 manifest 回归验证 Codex `native-audit` 只输出纠偏与 `unverified`，不宣称动作前硬拦截。
- `skills.json` / `references/skill-list.md` 同步 yotta-guardian 0.1.3。

## v0.12.0 (2026-09-13)

**P0-4.1 元信 before_install 试点**：

- 安装管线接入统一 hook 适配器：包内 `before_install` 声明在落位前评估，manifest 声明 `on_fail: block` 时扫描失败会阻断并保留旧版本。
- 适配器证据写入 `~/.yottaskills/hook-log.jsonl`；`--skip-scan` 仍走人工应急路径，标记 `explicit-unverified`，不会被误报为已验证。
- `skills.json` / `references/skill-list.md` 同步 yotta-verify 0.3.0。
- 新增安装管线 hook 阻断回归；真实 yotta-verify manifest 随 0.3.0 发布。

## v0.11.0 (2026-09-13)

**P0-3 运行时 hook 适配层**：

- 新增 `lib/hook-adapter.js`：六个统一事件、Codex 四档能力矩阵、manifest hook 声明校验、四档决策聚合和 `explicit-unverified` 降级。
- 新增 `hook capabilities / evaluate / bind / unbind` CLI：可查看宿主能力、评估事件、写入结构化证据、幂等注册与反注册声明。
- 证据写入 `~/.yottaskills/hook-log.jsonl`；绑定注册表写入 `~/.yottaskills/hook-bindings.json`，不直接改写宿主配置。
- `native-audit` 不宣称强制；失败时输出 `explicit-unverified` 与纠偏信号。未核验宿主一律 `unsupported`。
- 新增 `test/hook-adapter.test.js` 与 `test/hook-cli.test.js`；全量测试 131/131。
- 本版只交付适配器内核，具体技能接入留待 P0-4 试点。

## v0.10.0 (2026-09-13)

**更新检查缓存与后台周检**：

- 新增 `update --check --scheduled`：默认 7 天加 0 到 24 小时随机抖动，未到期不联网；到期只检查一次并把结果写入 `~/.yottaskills/update-check.json`。
- 后台周检网络失败时文本模式静默、退出码 0；`--json` 保留 `error` / `cache` 诊断字段，不把后台调度失败变成用户噪音。
- 手动 `update --check` 保持每次联网和 0 / 3 / 1 退出码；检查结果同样写入本地缓存，避免手动检查后立即重复周检。
- `update --auto` 继续复用完整安装管线，`--skip-scan` 不能绕过元信门禁；`DO NOT INSTALL` 阻断、保留旧版本并写入证据。
- SKILL / README / FAQ / 教程 / 走查同步：移除“会话开工默认联网检查”，明确手动检查与后台周检边界。
- 新增 `lib/update-check.js`、`test/update-check-state.test.js`，并扩展 scheduled / auto 门禁回归。

## v0.9.0 (2026-09-13)

**doctor / rollback 与自定义生命周期**：

- 新增 `doctor`：只读检查技能目录、`SKILL.md`、版本、manifest 身份、注册表一致性和自定义 doctor 脚本；支持 `--json`。
- 新增 `rollback`：列出并校验快照，恢复最近一次安装或更新；恢复前后都保留快照与安装证据。
- 安装管线接入包内 `setup` / `doctor` / `rollback` 生命周期脚本；setup 或 doctor 失败时自动恢复旧版本，脚本路径只能指向包内相对路径。
- 新快照写入 SHA-256 元数据；旧快照仍可按结构校验和恢复。
- `--slug` 用于 doctor / rollback 定向处理单个技能。
- 新增生命周期、doctor、快照完整性与 CLI 回归测试。

## v0.8.0 (2026-09-12)

**P0-2.1 安装编排与元信自举**：

- 安装链路读取包内 `skill-manifest.json`，缺失时使用 `skills.json` 家族默认契约。
- 元信缺失时自动自举，随后对所有家族包执行装前扫描。
- `DO NOT INSTALL` 和扫描失败阻断安装；`CAUTION` / `REVIEW` 继续但显示风险。
- 安装改为快照、暂存、原子切换，失败不删除旧版本。
- 新增 `~/.yottaskills/install-log.jsonl` 安装证据。
- `--skip-scan` 仅保留为人工应急路径，并记录 `explicit-unverified`。

## v0.7.2 (2026-09-10)

skills.json 清单同步（元序路径模型澄清升版后，元阁安装清单随包更新）：

- yotta-workflow 0.3.0 → 0.4.0。
- skills.json 与 references/skill-list.md 同步，updated → 2026-09-10。
- 版本四件对齐 0.7.2；无功能代码变更。

## v0.7.1 (2026-09-09)

skills.json 清单同步（评测批 2 六技能升版后，元阁安装清单随包更新）：

- yotta-learn 0.1.4 → 0.2.0；yotta-humanize 0.1.3 → 0.2.0；
  yotta-security-testing 0.2.4 → 0.3.0；yotta-publish-guard 0.2.1 → 0.3.0；
  yotta-intel 0.1.1 → 0.2.0；yotta-secret 0.1.2 → 0.2.0。
- skills.json 与 references/skill-list.md 全量同步，updated → 2026-09-09。
- 版本四件对齐 0.7.1；无功能代码变更。

## v0.7.0 (2026-09-08)

**评测驱动完善**：新增 FAQ 与复杂场景走查；同步 22 技能清单并新增清单一致性测试，防止人工文档版本漂移；CLI 增加统一异常提示。

- 新增 references/faq.md 与 references/walkthroughs.md。
- skills.json 与 references/skill-list.md 全量同步，新增 test/skill-list.test.js 强制版本一致。
- CLI 增加顶层异常提示与修复建议。

## v0.6.2 (2026-09-06)

**更新检查 / 自动更新（`update --check` / `update --auto`）**：元阁 CLI 新增联网只读检查本地已装技能是否有更新（对 npm `dist-tags.latest`，版本源唯一），
按本地 `SKILL.md` 版本对比，无论技能源自哪个安装渠道（npm / git clone / 本地拷贝等）都兼容。`--check` 只读列清单，退出码 0=全部最新 / 3=有更新 / 1=查失败；
`--auto` 检测到家族（`yotta-*` / 清单内）可更新时走安装管线（含元信装前安全扫描）自动更新，非元阁家族（非 yotta-*）技能绝不自动更新。
新增 `--registry <url>` 自定义版本源；网络异常优雅降级（不阻塞会话）。SKILL.md「使用须知」注入文本同步加入「会话开工跑 `update --check`」规则。（v0.19.2 起：该规则已从注入文本移除，改为用户确认后的可选说明。）
测试：新增 update-check / update-auto 本地 HTTP registry 离线用例，npm test 47/47。
## v0.6.1 (2026-09-06)

**skills.json 全量清单对齐（22 技能 vs npm latest 全一致）**：yotta-memory 0.10.1 → 0.11.0（MCP 协议对齐批次发布后同步，元阁 install 按清单版本拉包，不同步会装到旧版）；源清单 + 构建副本双份同步；其余 21 技能核对无滞后。无功能代码变更。

## v0.6.0 (2026-09-06)

**MCP 协议对齐最新版 2026-07-28（无状态时代）**：yotta-skills MCP 升级 dual-era——modern 直连（server/discover 免握手、逐请求 _meta 版本声明、resultType、-32022）服务新客户端；legacy（initialize 握手，protocolVersion 2025-11-25）兼容旧客户端，旧形状响应零惊扰。SKILL 标注「基于 MCP 最新协议 2026-07-28（向后兼容 2025-11-25 及更早握手）」。npm test 42/42（含 modern MCP e2e）。

## v0.5.1 (2026-09-06)

skills.json 三处滞后同步修复（yotta-skills 0.5.0→0.5.1）：元真 0.1.2→0.1.3 / 元忆 0.8.5→0.10.1 / 元守 0.1.1→0.2.1 + updated 改期 2026-09-06 + yotta-skills 四件对齐 0.5.1 + 技能分发清单副本 + 插件同步。

## v0.5.0 (2026-08-31)

方案 A（其他已装技能候选编排）：路由输出从「只编排元阁组合」扩展为「组合 + 并列候选提示」。

- 新增 `--route` / `route_request` 输出「其他已装技能候选」：注册表中非元阁家族的已装技能，按 frontmatter `description` 与需求文本做本地机械匹配（英文词项 + 中文二字组交集），Top N（默认 3）并列展示，标注来源、得分、命中词项与扫描状态。
- 安全边界：只读 frontmatter `description` 做机械匹配，不读取全文指令、不做语义推理、不自动调用；候选默认标注「未扫描」，使用/安装前需先做装前安全扫描；数据不出本机。
- 确定性：同输入同输出，无状态、无个人数据；候选不参与组合融合排序，7 个静态组合输出保持不变。
- CLI 文本输出追加「其他已装技能候选」段；`--json` 追加 `other_skill_candidates` / `other_skills_note` 字段；MCP `route_request` 同步。
- 测试：路由核心新增候选匹配 / 元技能排除 / Top N 与排序 / 确定性 / 空结果；CLI JSON 与文本输出用例。
- 版本升至 0.5.0。

## v0.4.0 (2026-08-31)

阶段 C（O1 静态编排 playbook + 路由指引）：从「知道装了什么」升级为「给出该用哪几个、什么顺序」。

- 新增静态编排 playbook（7 个场景组合）：输出呈现、长生命周期、交付质量门、装前安全门、造技能发版、安全事件响应、入口安装。
- 新增 CLI `--route "<需求摘要>"`：先更新本地注册表，再输出候选组合、调用顺序、技能角色、置信度、命中依据、已装/缺失状态、安装命令与应用模式提醒；支持 `--json`。
- 新增 MCP `route_request` 工具，与 CLI 复用同一套路由核心；MCP 工具扩展为四个。
- 缺失技能只建议安装，不自动安装；安装命令需用户确认并先执行装前安全扫描。应用模式默认显式调用，切换为按场景自动调用需用户确认。
- 文档：SKILL.md / README 中英 / orchestration.md / tutorial.md 同步「编排路由」层与边界；banner 同步升级为编排层定位。
- 测试：新增路由核心（playbook 完整性 / 命中顺序 / 缺失建议 / 无匹配兜底 / 应用模式）、CLI JSON 与文本输出、MCP e2e 用例。
- 版本升至 0.4.0。

## v0.3.0 (2026-08-31)

阶段 B（D2 re-index 自动钩子）：新装技能自动被发现。

- 新增 CLI `--reindex`：重扫所有技能目录并增量合并注册表，变化聚焦输出（文本 / `--json` 机器可读），供钩子与手动调用；`--rescan` 为同义别名。
- 装技能后自动 re-index：`install` / `update` 完成后自动重扫注册表，把本次落位结果反映进 `~/.yottaskills/registry.json`（新增 / 更新 / 消失随输出列出）；`--no-reindex` 可关闭。
- 会话开工 re-scan：SKILL.md「使用须知」护栏补「会话开工先跑一次 `yotta-skills --reindex`」；注册表 `note` 口径同步 `--inventory / --reindex`。（v0.19.2 起：该常驻要求已移除，改为可选提示。）
- MCP `reindex` 工具改走 `--reindex --json`（同一套扫描核心）；CLI 等价命令注明。
- 文档：SKILL.md / README 中英 / references/install-flow.md / tutorial.md 同步 re-index 用法。
- 测试：新增 `--reindex`（含幂等）与装后自动 re-index（含 `--no-reindex` 关闭）用例；全量用例全绿。
- 版本升至 0.3.0。

## v0.2.1 (2026-08-31)

MCP 配置说明补全（按需加载口径）。

- SKILL.md「技能盘点」节补「MCP：按需加载（可选）」：明确本技能与 MCP 均为按需触发、不走常驻；mcpServers 配置 JSON 示例、配置步骤（用后可移除）、重启/重载提示、未加载降级 CLI 兜底；frontmatter description 同步按需加载口径。（v0.19.2 起：写入客户端配置前必须先获得用户明确同意。）
- 测试：mcp-e2e serverInfo.version 断言改为动态读 package.json；python 探测加候选兜底（YOTTA_TEST_PYTHON / python / python3 / Scoop python38），Windows 无需手动设环境变量。
- 版本升至 0.2.1。

## v0.2.0 (2026-08-31)

技能生态盘点层（阶段 A）：元阁从「编排策划 + 安装器」升级为「编排策划 + 安装器 + 技能盘点」。

- 新增 lib/skills-scan.js：技能扫描核心（零依赖 Node.js 18+）——frontmatter 解析（含 YAML block scalar）、多根目录扫描、同名技能去重合并来源、注册表增量合并（新增/更新/消失，幂等）、原子写 ~/.yottaskills/registry.json。
- 新增 CLI --inventory：盘点本机已装技能（文本表格 / --json 机器可读；--dir 追加目录；--project 附扫项目级目录），自包含输出不依赖任何元技能。
- 新增 MCP scripts/yotta-skills-mcp.py：stdio JSON-RPC（零依赖），list_installed_skills / describe_skill / reindex 三工具，按需加载。
- SKILL.md / README 中英同步「技能盘点」层与用法；frontmatter 触发语加「盘点技能 / 查看已装技能」。
- 测试：skills-scan 7 + cli-inventory 2 + mcp-e2e 2（共 23 用例全绿）。
- 版本升至 0.2.0。

## v0.1.3 (2026-08-31)

编排策划层升级：元阁从「一键安装器」升级为「总编排策划 + 一键安装器」两层。

- SKILL.md 重写：新增「使用须知」节——提供「元阁编排策划」护栏文本，供用户确认后写入客户端全局记忆；新增「编排策划」节（7 组组合矩阵 + 场景映射 + 组合建议规则）；frontmatter description 同步「总编排策划 + 一键安装器」定位与触发语。（v0.19.2 起：写入改为可选步骤 + 显式确认，并移除常驻授权表述。）
- 新增 references/orchestration.md：编排策划决策表（技能家族全景 / 组合矩阵 / 场景映射 / 自动安装规则）。
- skills.json 清单版本同步（2026-08-30：yotta-memory 0.8.5 / yotta-security-audit 0.2.2 / yotta-vetter 0.2.3 / yotta-security-testing 0.2.4 等六处）。
- README 中英版定位同步「编排策划 + 一键安装」两层。
- 测试：pin 断言同步至 yotta-memory 0.8.5。
- 版本同步升至 0.1.3。

## v0.1.2 (2026-08-29)

安装方法清晰化：install.sh 用途与 README 中英「安装」章节对齐。

- 修正 install.sh 头部注释：明确其只把「元阁安装器技能」本身装进智能体/目录（自带 SKILL.md，
  让代理能调用元阁），并提示装齐 22 个 yotta-* 技能需再跑 `node bin/yotta-skills.js install`；
  避免用户误以为 `bash install.sh` 一次就装齐全家。
- 版本同步升至 0.1.2。

## v0.1.1 (2026-08-29)

文档修正：明确「元阁是全家安装器、与单个技能安装不同」。

- 更正 README 中英版「安装」章节：先分清「拿到安装器」与「装齐全家」两层（元阁本身不内置 22 个技能本体）；方式二 git clone / 方式三 Download ZIP 示例由 `--list` 改为 `install --dir <目标目录>`；方式四 install.sh 说明「只把安装器技能本身装进智能体目录」，装齐 22 个技能仍需再跑一次 `install`。
- 澄清：`--list` 只查看清单、不安装；克隆 / 解压只拿到安装器，不含任何技能本体。
- SKILL.md 增补「与单个技能安装不同」说明；版本同步升至 0.1.1。


## v0.1.0 (2026-08-29)

初始发布：

- 定位：元阁 —— 全家技能一键安装 CLI（「分发与安装」家族，市场主线 M2「全渠道分发」第一步，
  降低「n 个技能逐个装」门槛）。
- CLI（bin/yotta-skills.js，零依赖 Node.js 18+）：
  - `--list` 列出全家技能 + 版本 + 说明（可按技能名过滤）；
  - `install --agent <name>` / `install --dir <path>` 装全家或指定技能；
  - `update` 增量更新（补齐缺失 / 升级版本不一致）；
  - `--dry-run` 预览不联网不改动；`--pin` 锁死清单精确版本；
  - `--force` / `--skip-scan` / `--npm` / `--python` / `--verify` 等选项。
- 清单：skills.json 收录 22 个已发布技能（登记表为权威源，2026-08-29 校准；
  元安全 / 元测 / 元造 / 元守 / 元察 / 元情 / 元钥 / 元链 / 元鉴 等补入）。
- 机制：逐技能 `npm pack` → 系统 tar 解压 → 元信装前摘要（若可用，仅提示不拦截）→
  落位 `<dest>/<slug>` → 汇总报告（✔ 成功 / - 跳过 / ✘ 失败，有失败项退出码 1）。
- 幂等：目标 `<slug>/SKILL.md` frontmatter version 与清单一致即跳过；`update` 只补缺失 /
  版本不一致。
- 版本策略：默认 range（`major.x` 取同 major 最新 patch）；`--pin` 锁死可复现。
- 支持智能体：内置 17 个键名（claude / cursor / codex / gemini / goose / amp / opencode /
  windsurf / workbuddy / kiro / trae / trae-cn / qwen / comate / codebuddy / kimi / agents）；
  未收录用 `--dir` 指目录。
- Windows npm 解析：定位 npm.cmd 同目录 npm-cli.js 用 node 直跑（规避 EINVAL / cmd 引号坑）。
- 测试：12 用例全绿（--list / 临时目录安装断言 / 幂等 / --pin / update / 异常路径 /
  元信 scan 集成）+ 全家族联网实测 22/22 安装成功、版本全对齐、幂等复跑 22 跳过。
- 文档：SKILL.md（中立版）+ references 三件（skill-list 全家清单 / install-flow 内部机制 /
  tutorial 中文教程）+ README 中英双版。
- 发布件：LICENSE（MIT）/ NOTICE / banner（1280×640）/ install.sh。
