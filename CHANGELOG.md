# 更新日志

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

- 新增 CLI `--reindex`：重扫所有技能目录并增量合并注册表，变化聚焦输出（文本 / `--json` 机器可读），供会话开工与钩子调用；`--rescan` 为同义别名。
- 装技能后自动 re-index：`install` / `update` 完成后自动重扫注册表，把本次落位结果反映进 `~/.yottaskills/registry.json`（新增 / 更新 / 消失随输出列出）；`--no-reindex` 可关闭。
- 会话开工 re-scan：SKILL.md「使用须知」护栏补「会话开工先跑一次 `yotta-skills --reindex`」；注册表 `note` 口径同步 `--inventory / --reindex`。
- MCP `reindex` 工具改走 `--reindex --json`（同一套扫描核心）；CLI 等价命令注明。
- 文档：SKILL.md / README 中英 / references/install-flow.md / tutorial.md 同步 re-index 用法。
- 测试：新增 `--reindex`（含幂等）与装后自动 re-index（含 `--no-reindex` 关闭）用例；全量用例全绿。
- 版本升至 0.3.0。

## v0.2.1 (2026-08-31)

MCP 配置说明补全（按需加载口径）。

- SKILL.md「技能盘点」节补「MCP：按需加载（可选）」：明确本技能与 MCP 均为按需触发、不走常驻；mcpServers 配置 JSON 示例、按需写入步骤（用后可移除）、重启/重载提示、未加载降级 CLI 兜底；frontmatter description 同步按需加载口径。
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

- SKILL.md 重写：新增「使用须知（先做这一步）」——首次使用将「元阁编排策划」护栏写入客户端永久记忆，使下个会话自动注入；新增「编排策划」节（7 组组合矩阵 + 场景映射 + AI 自动安装与组合规则金标准）；frontmatter description 同步「总编排策划 + 一键安装器」定位与触发语。
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
