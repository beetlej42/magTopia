# MAGTOPIA Core Gameplay Implementation Plan

> 目标：给后续开发 Agent 一个可直接执行的顺序。先做最小可运行核心循环，不先扩卡牌、复杂事件树或职业成长。

## 0. 当前状态与迁移原则

现有 `src/city/state.js` / `engine.js` 仍是旧模型：`coins + timber + stone`，并存在手动 `advance_time`。这部分不要继续扩展旧规则。

迁移原则：

1. 保留现有建设、道路、district、资产和幂等链路；
2. 新增独立 gameplay/simulation 层，不把玩法规则塞进 voxel grammar；
3. 所有资源、人口、暴露、事件结果统一由一次 `resolveTurn()` 结算；
4. wall clock 只负责“开放/截止回合”，不直接产资源；
5. Agent 只提交建设决策、事件派遣和日报文本，系统保留规则与随机数权威。

---

# 第一阶段：先做可测试的 Simulation Core

这是最应该先开发的部分。

第一阶段不要接卡牌，不要先做 UI，不要先做完整 Agent 日报。目标是：给定一座已有城市，纯代码能够稳定完成一次回合结算，并得到结构化事实。

## 1.1 建议新增文件

### `src/gameplay/schema.js`

定义和 normalize 核心玩法结构：

- `GameplayBuilding`
- `PopulationState`
- `VeilWarden`
- `ExposureIncident`
- `TurnState`
- `TurnFacts`

第一版尽量使用普通 JS object + 显式 normalize/validate，保持与现有代码风格一致，不必为了这一阶段引入大型 schema 框架。

### `src/gameplay/building-metadata.js`

负责从现有 building program / archetype / `magicLevel` 得到稳定 Gameplay Metadata。

输入：现有 `building`

输出至少：

```js
{
  category,
  magicLevel,
  muggleCapacity,
  wizardCapacity,
  coinOutput,
  magicOutput,
  concealment,
  activity,
  jobs
}
```

要求：

- 不读取渲染器状态；
- 不依赖具体 voxel mesh；
- 同一 building spec 输入必须得到确定性结果；
- 允许 Agent 未来显式覆盖受支持字段，但必须 normalize。

### `src/gameplay/exposure.js`

纯函数实现：

- 邻域掩护计算；
- 单建筑 exposure pressure；
- 本回合 exposure delta；
- incident 生成候选条件；
- sealed 阈值判断。

第一版先用简单邻域距离和固定权重，不追求最终平衡。

### `src/gameplay/simulation.js`

核心入口：

```js
resolveTurn(state, input, context) => {
  nextState,
  facts
}
```

建议内部顺序：

1. 计算建筑 Gameplay Metadata；
2. 结算金币、魔力；
3. 结算普通/魔法师人口；
4. 更新 exposure；
5. 生成本回合 incidents；
6. 若有已提交 assignment，则系统结算骰子；
7. 应用 incident outcome；
8. 处理 sealed；
9. 生成不可变 `TurnFacts`；
10. `turn += 1`。

第一阶段可以只支持“没有 Agent assignment 的 incident 留待下一步骤处理”，但数据结构必须提前支持 assignment/outcome。

### `src/gameplay/random.js`

集中封装系统随机数。

要求：

- production 可使用真实随机源；
- test 可注入 seed / deterministic roller；
- `TurnFacts` 必须保存原始 roll 和 modifiers；
- Agent输入绝不能携带最终骰值。

## 1.2 修改现有文件

### `src/city/state.js`

将 CityState 升级为新 schema 版本，增加：

```js
gameplay: {
  turnStatus,
  resources: { coins, magic },
  population: {
    muggles: { current, capacity },
    wizards: { current, capacity }
  },
  wardens: {},
  incidents: {},
  lastTurnFacts: null
}
```

建议暂时保留旧 `resources` 字段做兼容读取，但新 gameplay 逻辑不得继续增加 timber/stone 规则。等迁移完成再删除旧字段。

### `src/city/engine.js`

第一阶段：

- 不再扩展旧 `calculateDailyIncome()`；
- 将 `advance_time` 标记为 legacy/debug-only；
- 新增明确的系统级 turn command 或调用入口，但不要允许普通 Agent 任意推进回合；
- 建设命令仍走现有 City Engine，Simulation 不重复实现建设逻辑。

推荐边界：

```text
City Engine = 建哪里 / 能不能建 / 扣建设成本 / 道路
Gameplay Simulation = 本回合城市产生了什么后果
```

### `apps/server/repository.js` 和 `memory-repository.js`

第一阶段只需要确保新版 state_jsonb 可透明读写，不急着拆出新表。

玩法状态仍先放在 CityState JSON 中，等 schema 稳定后再决定 incident / warden 是否需要独立 projection table。

## 1.3 第一阶段测试

建议新增：

- `test/gameplay-building-metadata.test.js`
- `test/gameplay-exposure.test.js`
- `test/gameplay-simulation.test.js`

至少覆盖：

1. 普通住宅增加 muggle capacity；
2. 高魔法住宅增加 wizard capacity；
3. 普通建筑提高邻域 concealment；
4. 高 magicLevel 在缺少掩护时 exposure 上升；
5. 增加普通市场后 exposure pressure 下降；
6. 一次 `resolveTurn()` 只结算一次收入；
7. 改变 wall clock 但不调用 `resolveTurn()` 不改变资源；
8. 同 seed + 同 state 得到相同 incident/roll；
9. exposure 到阈值后 building 进入 `sealed`；
10. `TurnFacts` 足够描述所有状态变化。

### 第一阶段验收

完成后应该可以写一个纯测试场景：

```text
5 栋普通建筑 + 2 栋高魔法建筑
      ↓
resolveTurn()
      ↓
得到 coins/magic/population delta
得到两栋建筑 exposure change
可能生成 incident
得到完整 TurnFacts
```

做到这里再进入下一阶段。

---

# 第二阶段：帷幕守卫与 Agent 策略接口

## 2.1 新增 `src/gameplay/wardens.js`

实现：

- 编制上限：默认 `floor(wizardPopulation / 10)`；
- 雇佣成本；
- 三项基础能力：`investigation / containment / concealment`；
- specialties；
- available / assigned / unavailable 状态。

职业展示名暂用“帷幕守卫”，内部字段建议保持中性，例如 `responder` / `warden`，避免未来命名调整牵动 schema。

## 2.2 新增 `src/gameplay/incidents.js`

先做 3 类事件即可：

- investigation
- containment
- concealment

每类准备少量结构化模板，不急着写长故事。

## 2.3 新增 Agent assignment API

涉及：

- `apps/server/app.js`
- `apps/server/openapi.js`
- `apps/server/repository.js`
- `apps/server/memory-repository.js`
- Agent playbook 文档

建议 API 语义：

```text
GET  current incidents + available wardens
POST incident assignments
POST finish strategy phase
```

系统验证：

- 人员存在且可用；
- 同一人员不能同时处理两个互斥事件；
- incident 尚未结算；
- assignment 不能包含骰值或 outcome。

## 2.4 骰子

MVP 可先用单一统一公式，具体平衡后调：

```text
roll + relevantAttribute + specialtyBonus + modifiers vs difficulty
```

输出四档结果，并把：

- raw roll
- attribute
- specialty bonus
- modifiers
- difficulty
- outcome

全部写入 TurnFacts。

---

# 第三阶段：回合状态机与自然时间调度

在 Simulation Core 稳定以后再接 wall clock。

## 3.1 建议新增 `src/gameplay/turn.js`

回合状态至少：

```text
open
building
strategy
resolved
reported
closed
```

不要把状态机散落在 HTTP route 中。

## 3.2 server scheduler

建议新增：

- `apps/server/turn-scheduler.js`

职责只有：

- 根据 wall clock 判断是否开放新回合；
- 判断当前回合是否超时；
- 超时时触发系统默认收尾；
- 永远调用同一套 Simulation API，不另写“离线模拟规则”。

MVP 不做复杂长期离线模拟。先保证一个已到期回合可以安全自动关闭。

---

# 第四阶段：TurnFacts → Agent 猫头鹰日报

日报不是系统自由生成故事。

系统提供事实，Agent写叙事。

## 4.1 建议新增 server projection

提供给 Agent 的结构化数据包括：

```text
resourceDelta
populationDelta
constructionChanges
exposureChanges
incidents
assignments
rolls
outcomes
sealedBuildings
nextRisks
```

## 4.2 Agent playbook

明确要求 Agent：

- 不创造 TurnFacts 之外的事实；
- 可以加入语气、解释和个人判断；
- 必须解释关键派遣理由；
- 最后给出下一回合计划；
- 日报写完才完成正常回合。

如果 Agent 缺席，系统只保存 facts + 最低限度摘要，不需要伪装成 Agent 写故事。

---

# 第五阶段：玩家卡牌

卡牌最后接。

原因：卡牌本质是 turn modifier；在稳定的 `resolveTurn()` 之前实现卡牌，会把临时效果散落到旧经济、事件和建设逻辑中。

第一版卡牌只需能产生结构化 modifier，例如：

```js
{
  target: "district-x",
  effect: "concealment_bonus",
  value: 2,
  remainingTurns: 2
}
```

---

# 不要在第一轮开发的内容

- 不要先做大量事件文本；
- 不要先做职业等级/装备/技能树；
- 不要先做复杂卡牌池；
- 不要为了玩法重写现有建筑生成系统；
- 不要把 Simulation 规则放进 Three.js/viewer；
- 不要做第二套 realtime resource tick；
- 不要让 Agent 提供骰子结果；
- 不要直接删除旧 state 字段导致已有建设/验收链全部失效。

---

# 推荐第一批 PR 拆分

## PR A — Gameplay state + deterministic turn simulation

最优先。

涉及：

- `src/gameplay/schema.js`
- `src/gameplay/building-metadata.js`
- `src/gameplay/exposure.js`
- `src/gameplay/random.js`
- `src/gameplay/simulation.js`
- `src/city/state.js`
- tests

不改 HTTP，不改 UI。

验收：纯测试可以完整 resolve 一个回合并输出 TurnFacts。

## PR B — Wardens + incidents + dice assignment

涉及：

- `src/gameplay/wardens.js`
- `src/gameplay/incidents.js`
- simulation 扩展
- tests

验收：同一个 incident 给不同属性人员处理会产生不同成功概率，系统骰可确定性测试。

## PR C — Agent strategy API

涉及 server/OpenAPI/playbook。

验收：Agent 能读取 incident/warden，提交 assignment，系统完成合法性校验和结算。

## PR D — Turn scheduler + deadline fallback

验收：自然时间到期不会直接累计资源，只会触发一次标准回合收尾。

已实现（`apps/server/turn-scheduler.js` + `src/gameplay/turn.js`）：

- `turnStatus` 保持 `open / building / strategy -> resolved -> (unlock 后) next open`，新增持久化字段 `turnDeadlineAt`、`nextTurnUnlockAt` 与最小 `scheduler` 元数据（`settledBy` / `openedAt` / `resolvedAt`）。
- wall clock 只做解锁与截止；资源、人口、暴露、incident 仍只由唯一 `resolveTurn()` 结算。
- Agent 主动 resolve 与 deadline 自动收尾都调用同一个 `resolveTurn()`。未分配人员且仍 `open` 的 incident 进入统一保守路径：记入 `facts.unaddressedIncidents`、保持 `open`、对所在建筑施加温和暴露惩罚——超时不等于免费跳过风险，且不存在第二套事件逻辑。
- exactly-once：`schedulerTransact` 对城市行 `FOR UPDATE` 加锁 + `expectedVersion` 校验 + 确定性 idempotency key（`resolve-deadline-<turn>`），并发或重试不会双结算；输家收到 `TURN_ALREADY_RESOLVED` / `CITY_VERSION_CONFLICT`。
- 重启安全：unlock/deadline 以持久化时间戳为准；轮询 worker 重启后重新扫描并处理 overdue / 已解锁回合。
- 时间策略属于 server/world config（`MAGICTOWN_TURN_INTERVAL_MS` / `MAGICTOWN_TURN_DEADLINE_MS`），不写死时区；测试使用 injectable clock，不 sleep。
- 下一回合 unlock 锚定当前回合的 wall-clock slot（`turnOpenedAt + turnIntervalMs`），而非结算时刻：Agent 提前 resolve 与拖到 deadline 自动收尾得到同一 cadence，连续缺席仍是“一自然日一回合”，deadline 收尾不会再多罚一整个 interval。
- Agent 无法伪造 `force` / `nextTurnUnlockAt` / `turnDeadlineAt` / scheduler trigger（strategy 请求体白名单只允许 assignments/expected_city_version/actor_note）。
- 卡牌（PR F）未实现：无卡牌是合法可结束状态。

## PR E — Owl Daily newspaper / narrative interface

已实现（`src/gameplay/owl-report.js` + `apps/server/migrations/004_owl_reports.sql` + 三个 API 端点）：

- 双层模型：`ReportContext`（SYSTEM 拥有，从 immutable TurnFacts + 只读 city metadata 确定性投影，deep-freeze，无 prose、不重算 gameplay）与 `OwlReport`（Agent 编辑的报纸：masthead / edition / headline / subheadline? / lead / articles[] / briefs[] / actionBox? / tomorrowWatch?）。新闻价值排序、section 选择与叙事完全属于 Agent。
- 稳定事实引用：`fact-incident-<id>`、`fact-roll-<id>`、`fact-outcome-<id>`、`fact-assignment-<id>`、`fact-building-<id>`、`fact-unaddressed-<id>`、`fact-risk-<id>`、`fact-resource-delta`、`fact-population-delta`。article/brief/actionBox/tomorrowWatch 通过 `relatedFactRefs` / `incidentRef` / `factRefs` 声明 provenance；引用不属于该回合 context 的 ref 会被拒绝（`UNKNOWN_FACT_REF` / `UNKNOWN_INCIDENT_REF`）。
- Agent 不可提交或覆盖任何 system facts：请求体只接受 `turn` / `facts_digest` / `report`，report 顶层字段白名单只允许报纸组成字段；dice / modifier / outcome / delta / incident/officer status / settledBy / timestamp / gameplay state 全部拒绝。
- 绑定与防篡改：`GET /report-context?turn=N` 返回该回合冻结 facts 的 `factsDigest`；提交必须携带同一 digest，否则 `FACTS_DIGEST_MISMATCH`；未解析回合 `TURN_NOT_RESOLVED`。
- canonical：一个 settled turn 只允许一份报告（`owl_reports` 表 `UNIQUE(city_id, turn)` + `REPORT_ALREADY_EXISTS`），相同 Idempotency-Key 重放返回原响应，不产生第二份日报。
- scheduler 独立：发布报告不写 city row、不推进 city_version，因此绝不阻塞 turn scheduler 开启下一回合。deadline turn 同样可报告，context 明确暴露 `settledBy="deadline"` 与 `unaddressedIncidents`（哪些事件无人处理、风险因此上升），Agent 不得虚构秘法官处理过未派遣事件。
- 补写：`state.gameplay.turnFacts` 保留最近 200 个已结算回合的冻结 facts，Agent 可在后续任意时刻为较早的 resolved turn 补写日报；重启后报告与 facts binding 仍然成立。
- 端点：`GET /cities/{city_id}/report-context`、`POST /cities/{city_id}/reports`（Idempotency-Key）、`GET /cities/{city_id}/reports`、`GET /cities/{city_id}/reports/{report_id}`。
- 测试：`test/serverOwlReportApi.test.js` 覆盖 context 完整性 / 严格来自 frozen facts / rationale-roll-outcome-exposure / deadline + unaddressed / 无法覆盖 system facts / 非法 fact ref 拒绝 / stale turn 拒绝 / 单 canonical 报告 / idempotent replay / report 失败不改 gameplay / report 不阻塞 scheduler / 重启后 binding 仍存在 / OpenAPI 与 playbook 描述。
- 明确不在本 PR：真实 LLM 调用、自动生成文案、报纸 UI、图片生成、Player cards、Officer XP/rank、新 gameplay mechanics，以及魔法天气 / 小广告 / 流言 / 读者来信 / 社会版等扩展版块（schema 通过白名单 + 校验扩展，未来 PR 只需加入新字段与其校验）。

## PR F — Player cards

最后接 modifier。

---

# 给开发 Agent 的一句话原则

如果实现中出现两种“城市如何随时间变化”的算法，方向就是错的。

MAGTOPIA 只应该有一套确定性的回合 Simulation：

```text
wall clock -> 触发回合边界
Agent -> 提交决策
system -> resolveTurn()
TurnFacts -> Agent叙事
```

所有新机制最终都应以输入或 modifier 的形式进入这条链，而不是在旁边创建第二套规则。
