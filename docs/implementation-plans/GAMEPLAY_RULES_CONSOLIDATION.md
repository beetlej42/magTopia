# Gameplay Rules Consolidation

## Goal

收口 MAGTOPIA 当前已经落地但仍有旧语义残留的核心玩法，使新建城市从 Turn 0 就运行同一套正式规则；同时保留一个可配置的最小回合间隔，用于把正式 24h 节奏在测试环境加速到 60min、10s 等，而不引入第二套测试玩法。

本 PR 不迁移旧测试城市。旧测试城市可直接废弃，验证以新建城市为准。

## Product contract

### 1. One gameplay, accelerated only by time gate

- 回合不会因为 wall clock 到点而自动结束。
- Agent / 正常 gameplay flow 主动结束回合。
- `nextTurnUnlockAt` 表示“当前回合最早允许结束并进入下一回合的时间”。
- 在 turn opened 时计算：`nextTurnUnlockAt = turnOpenedAt + TURN_COOLDOWN_SECONDS`。
- 如果 Agent 工作时间已经超过 cooldown，完成后可以立即 resolve；如果 Agent 很快完成，则等待 unlock。
- 不允许离线补算多个回合，不允许 timer 自动连续推进。
- 缩短 cooldown 只影响等待时间；资源、人口、暴露、incident、卡牌、建筑成本和产出等正式玩法数值全部不变。
- production 可配置为 86400s；ECS 测试环境可用 3600s / 10s。

删除/停用现有“deadline 到点自动 settle”的语义。不要让 `turnDeadlineAt` 继续驱动自动结算；若为兼容 API 暂时保留字段，应明确 deprecated / null，不得影响 authoritative flow。

### 2. New-city economy is the new gameplay economy

新城市从 Turn 0 直接使用新版 gameplay 语义。

玩家/Agent gameplay 层的基础可消费资源只认金币：

- 初始金币按当前合理默认值保留（例如 600，除非现有 balance 定义已有 authoritative 常量）。
- 不再初始化 timber / stone 作为玩家核心资源。
- `gameplay.resources.magic` 可以从 0 开始；它属于 gameplay 状态，不需要为了测试人为赠送。
- population / exposure / Arcane Officers / incidents 都按正式规则正常初始化，不因 fast-test 模式改变数值。

如果底层旧 construction path 仍依赖 `state.resources.timber/stone`，不要用假数据继续暴露旧经济。请先审计依赖并选择最小收口方案：优先让 construction cost / affordability 使用新版 authoritative economy；若一次 PR 无法安全移除 legacy 字段，则可以暂时内部兼容，但新城市 player-facing / agent-facing contract 不得继续把 timber/stone 描述为正式玩法资源，并在 PR 中明确剩余技术债。

### 3. Agent must understand the whole game, with progressive disclosure

`docs/agent-playbook.md` 是 Agent 的 authoritative 操作手册，但目前偏 API 使用说明，需要增加一个短而明确的 `MAGTOPIA Gameplay Model` 总览，并修正过时 scheduler 描述。

总览至少说明：

- PLAYER：通过三选一卡牌、手动特殊建筑放置、自然语言等做少量高影响决定。
- AGENT：长期经营城市，负责规划、建设、理解玩家决定、控制发展节奏、处理 exposure 风险并分配 Arcane Officers。
- SYSTEM：拥有卡牌真实效果、资源结算、人口、暴露、incident 生成、roll/outcome 和 authoritative state；Agent 不得自行编造结果。
- 核心循环：`player choice → Agent planning/building → gameplay state/exposure changes → incident response if needed → Agent resolves turn when appropriate and unlocked → system settlement → Owl Daily → next turn`。
- 新的 cooldown 规则：没有自动 deadline settlement；`nextTurnUnlockAt` 只是最早允许结束回合的时间门槛。
- 卡牌：Agent 不得替玩家选；special structure 的 `player_place` 不得抢占，`delegate_to_agent` mandate 需要 Agent 后续完成。
- exposure / concealment / incidents / Arcane Officers 是核心发展约束，不是旁支系统。
- Agent 的目标不是单纯最大化建筑数量，而是在空间质量、人口/经济、魔法活动、隐蔽风险和 incident response 之间做可解释权衡。
- 回合结束是一个有意义的决策：完成本回合主要发展目标、处理高优先级事件且无明显应继续的工作时，可以 resolve；如果尚未 unlock，则停止低价值新增工作并等待。

### 4. Progressive disclosure contract

不要每次把完整 playbook 塞进所有 API response。

实现一个稳定、低 token 的发现路径：

- 首次连接 / Agent onboarding 明确要求先读 playbook；
- `/snapshot?view=agent` 或 `/strategy` 等关键 read model 提供短的 `gameplay_guidance` 和/或 `playbook_url` / `playbook_path`；
- guidance 只包含当前阶段最关键的 1–3 条提示，不复制整篇文档；
- 在卡牌 pending、player placement pending、delegated placement、incident strategy、turn locked 等状态下，可按上下文渐进提示对应规则；
- 不要把建议做成硬约束，除非本来就是 SYSTEM authoritative validation。

建议最基础 discovery 文案类似：

> Read the MAGTOPIA Agent Playbook before planning. Player choices are authoritative. Balance development with population, exposure, concealment, and incident risk.

具体字段名应结合现有 API 风格决定，避免重复造多个 guidance 字段。

## Implementation work

### Scheduler / turn lifecycle

审计当前 scheduler、`resolveTurn()`、city-day projection、strategy payload、OpenAPI 和 tests：

- 移除 deadline 自动 settle 触发路径；
- 增加 `TURN_COOLDOWN_SECONDS` 配置（命名可按现有 config convention 调整）；
- turn open 时写入 `turnOpenedAt` 与 `nextTurnUnlockAt`；
- resolve endpoint / flow 在 unlock 前拒绝，并返回明确 code/message 和 `next_turn_unlock_at`；
- unlock 后仍需 Agent/正常 flow 主动 resolve；
- 不允许一次 timer/run 补多个 turn；
- city-day 视觉 phase 仍由 workflow state 驱动，不由 wall clock 自动 morning→day→night。

### New-city initialization / economy cleanup

- 新建城市测试以新版 gameplay 为准，不做 legacy migration。
- 初始玩家核心资源只有 coins；移除新城 timber/stone 的正式 gameplay 初始化/展示语义。
- 审计 `state.resources`, `gameplay.resources`, `economy`, construction preview/order、snapshot/UI/Agent read models 的读取来源。
- 统一 authoritative source，避免两个 coins ledger 可独立漂移。
- 如果 legacy construction resource schema 本 PR 只能内部保留，必须保证：玩家 UI、Agent playbook、Agent gameplay context 不把 timber/stone 当正式资源；并写清后续移除点。

### Agent playbook + discovery

- 在 playbook 前部新增 gameplay model 总览。
- 更新 Strategy phase 中所有 `turn_deadline_at` / auto-settle 描述为新 cooldown contract。
- 保留现有 district-first、procedural voxel design、construction、incident/officer 的详细章节，作为渐进式执行说明。
- 为关键 Agent read model 增加轻量 playbook discovery / contextual guidance。
- OpenAPI 同步记录 guidance 字段与新的 turn timing semantics。

## Tests / acceptance

至少覆盖：

1. `TURN_COOLDOWN_SECONDS=10`：turn opened 后 10s 内主动 resolve 被拒绝；10s 后同一 resolve 成功。
2. 即使经过远超 cooldown 的 wall-clock 时间，只要没有主动 resolve，turn 不会自动结束。
3. scheduler tick / cron / read 请求不会自动推进 turn。
4. 不存在 offline multi-turn catch-up。
5. production/default 配置和 fast-test 配置只改变 timing gate，不改变 gameplay balance 结果。
6. 新建城市 player-facing / Agent gameplay resource contract 不再展示 timber/stone；coins 初始值正确。
7. 若 legacy state 字段暂存，测试它们不会成为第二套 authoritative coins/resource ledger。
8. `agent-playbook.md` 不再声称 deadline 自动 settle。
9. Agent 关键 read model 能发现 playbook，并在至少 card pending / delegated placement / incident strategy / turn locked 场景得到简短上下文 guidance。
10. 现有 card、city-day、strategy、scheduler、construction、UI 测试全量通过。
11. `vite build` 成功。

## Non-goals

- 不迁移当前旧测试城市。
- 不为 fast-test 创建特殊资源、特殊事件概率或特殊 balance。
- 不做新的卡牌、incident 类型或 UI 大改版。
- 不把完整 playbook 内容复制进每个 API response。
- 不让 timer 自动结束回合。

## Deliverable

实现完成后在 PR body 汇报：

- 最终 timing config 名称与 production/test 示例；
- 删除了哪些 auto-settle 路径；
- 新城市 authoritative resource source；
- legacy timber/stone 是否完全移除，若没有，剩余依赖是什么；
- playbook 新增的 gameplay model 和 progressive disclosure 入口；
- tests/build 结果；
- 已知 blocker / follow-up。
