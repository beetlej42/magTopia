# MAGTOPIA Agent 城市服务整体方案

> 状态：Phase 0–3 已实现，本文同时保留架构决策与后续演进边界  
> 核心目标：让每位玩家拥有一座独立城市，并能把一个专属入口交给自己的 Agent。Agent 通过稳定、可发现、可审计的 HTTP API 读取城市、查询空间、建设房屋、选择或生产资产、连接道路。

## 1. 这次要验证的产品闭环

第一阶段不是把当前浏览器原型简单“搬到服务器”，而是验证下面这条完整链路：

```text
玩家创建城市并获得 Agent 专属链接
  -> Agent 打开链接，自动找到 playbook 与 API 描述
  -> Agent 读取城市摘要和最近变化
  -> Agent 查询局部地块、建筑与可用资产
  -> Agent 预览一个建设或道路方案
  -> Agent 提交带幂等键的命令
  -> 服务端校验、扣费、落库并产生城市事件
  -> 新资产需要时进入异步生产，城市先显示预留地块/施工状态
  -> 玩家和 Agent 都能解释“发生了什么、为什么、现在进行到哪里”
```

MVP 的成功标准：不打开前端控制台，任意一个能够发 HTTP 请求的 Agent 仅凭专属链接，就能安全完成“读城—找地—建房—修路—核对结果”。

## 2. 架构决策

### 2.1 先做模块化单体，不做微服务

建议在当前仓库增加一个 Node.js + TypeScript 服务端，内部按领域模块隔离，但第一阶段部署为一个进程：

```text
Web / Agent
    |
    v
HTTP API + HTML/Markdown 文档入口
    |
    +-- Identity & capability links
    +-- City query API
    +-- City command API
    +-- Construction orchestration
    +-- Asset registry & production jobs
    +-- Simulation/tick scheduler
    |
    v
纯 City Engine（现有 state / solver / workbench 的演进版）
    |
    +-- PostgreSQL：玩家、城市、当前投影、命令、事件、任务
    +-- Object Storage：建筑图片、GLB、深度图、manifest
```

理由：城市建设命令需要同时校验地块、预算、版本并原子落库。过早拆服务会让事务、幂等和调试复杂很多。资产生产本身保持“异步任务边界”，以后可以独立成 worker，而不要求现在就是微服务。

### 2.2 REST + OpenAPI 是主协议，MCP 只作为未来适配层

Agent 获得的是普通 HTTPS URL；服务端公开：

- 人类可读的主页和 playbook；
- 机器可读的服务清单；
- OpenAPI 3.1；
- JSON REST API。

这样不绑定某一家 Agent 框架。未来可增加 MCP server，但 MCP 应调用同一应用服务，不能形成第二套游戏规则。

### 2.3 当前状态表 + 不可变事件日志，而非第一天做完整事件溯源

每个成功命令在一个数据库事务中：

1. 锁定并检查 `city_version`；
2. 执行纯领域命令；
3. 更新当前状态投影；
4. 写入不可变 `city_events`；
5. 写入异步任务（若有）；
6. 提交事务。

当前表负责高效查询，事件日志负责日报、审计、增量同步和将来的回放。暂不要求仅靠事件重建一切，但所有会改变城市的公开命令都必须产生领域事件。

## 3. 领域边界

### 3.1 City Engine：唯一规则真相

把现有 `src/city` 提炼成与浏览器、HTTP、数据库无关的包。它只接收：

```ts
executeCommand(cityState, command, ruleset) => {
  nextState,
  events,
  result
}
```

它负责：

- 地块占用、入口、预算和规则校验；
- 候选地块评分；
- 建筑与道路预览；
- 建筑到建筑、建筑到地块、地块到地块、语义节点之间的道路求解；
- 建设命令的原子状态变化；
- 输出确定性的领域事件。

它不负责认证、HTTP、数据库、对象存储、模型调用或叙事润色。现有 `state.js`、`solver.js`、`workbench.js` 已经接近这一边界；主要需要补齐稳定 ID、可注入时间、规则版本和命令/事件 schema。

### 3.2 Application Service：编排一次 Agent 动作

应用层负责：

- 解析城市和 Agent 身份；
- 检查 scope、配额、城市版本与幂等键；
- 加载城市投影和规则集；
- 调用 City Engine；
- 保存投影、事件与任务；
- 将内部错误转换为稳定 API 错误。

### 3.3 Asset Service：复用资产或发起生产

资产分为两层：

- `asset_definition`：可复用的全局或玩家私有建筑资产，包含 archetype、footprint、风格标签、manifest 与验证状态；
- `asset_job`：一次异步生产任务，从结构化 spec 经生成、切图、深度/法线、自动验收到 registry。

Agent 不能直接写最终生产 prompt 或注册任意远程文件。它提交受限的 `AssetSpec`，服务器附加项目的相机、地块、美术和安全合同。

### 3.4 Simulation Service：以后增长，不污染建设 API

离线演化、每日卡牌、Field、需求、政策和日报都通过独立命令与事件扩展：

```text
AdvanceCityTime -> DemandChanged / BuildingProposed / ResourceProduced
PlayCard        -> WorldModifierApplied
ApproveProposal -> ConstructionRequested
```

网络层仍然只是提交命令、读取投影，因此后续玩法不需要改写认证、多租户和 Agent 接入方式。

## 4. 多玩家、城市存档与专属链接

### 4.1 租户模型

最小关系：

```text
Player 1---N City 1---N AgentCredential
                 |
                 +---1 CitySnapshot / N CityEvents
                 +---N Buildings / Roads / Orders / Jobs
```

所有城市数据行都带 `city_id`；玩家资产和私有资产还带 `owner_player_id`。任何读写都先从凭证解析允许的 `city_id`，不能信任请求 body 中自报的玩家或城市归属。

### 4.2 “独立链接”应是一次性接入链接

玩家在城市设置页点击“连接 Agent”，得到类似：

```text
https://play.magtopia.example/connect/mtc_xxxxxxxxx
```

它是高熵、短期有效、可撤销、默认只能兑换一次的 capability。Agent 首次访问后得到：

- 城市 API base URL；
- playbook、OpenAPI、服务清单地址；
- 一个有 scope 和有效期的 bearer token；
- credential ID，供玩家日后单独撤销。

长期密钥不应永久放在 URL：URL 容易进入浏览器历史、代理日志和截图。开发期可提供“持久 capability URL”模式，但产品默认应采用一次性链接换 token。

建议 scope：

```text
city:read
city:build
city:connect
asset:request
city:admin        # 不给普通 Agent
```

每个凭证还可有限制：每日命令数、单次预算上限、允许的资产生产次数、过期时间。玩家可看到最近活动并随时撤销或轮换。

### 4.3 城市 URL 与凭证分离

城市本身有稳定公开标识：

```text
/cities/city_01J...
```

是否能看、能建，由 token scope 决定；不要把 `city_id` 当秘密。这样城市以后从私有改为可参观、分享截图或协作时，不必迁移全部 URL。

## 5. Agent 发现入口

项目主页同时服务人和 Agent：

```text
GET /
  HTML：产品说明、创建/打开城市、Agent 接入说明

GET /.well-known/magtopia-agent.json

The previous `/.well-known/magictown-agent.json` path remains available as a
compatibility alias for already-connected Agents.
  机器清单：版本、playbook、OpenAPI、认证方式、API 根地址

GET /agent/playbook.md
  Agent 的操作手册和推荐决策循环

GET /openapi.json
  完整 OpenAPI 3.1

GET /agent/examples/*
  最小 curl/JSON 示例和常见错误恢复
```

专属接入页也应在响应中返回这些链接，而不是把大段说明硬编码进 token 响应。所有错误响应都包含 `type`、`code`、`message`、`retryable`、`details` 和下一步建议。

Playbook 的第一版应明确告诉 Agent：

1. 先读城市摘要、版本号和 `available_actions`；
2. 只在需要时查询局部空间，不要每轮下载 2500 个完整地块；
3. 建设前先搜索建筑和资产；
4. 使用 `/previews` 看成本、冲突、路线和资源余量；
5. 提交命令必须带 `Idempotency-Key` 和预览返回的 `city_version`；
6. 收到版本冲突后重新读取，不要盲目重试；
7. 新资产是异步任务，轮询订单或读取事件，不要重复创建；
8. 最后读取增量事件，确认实际结果并记录建设理由。

## 6. API 面设计

统一前缀：`/api/v1`。示例省略鉴权头。

### 6.1 城市摘要与增量变化

```http
GET /api/v1/cities/{city_id}
GET /api/v1/cities/{city_id}/snapshot?view=agent
GET /api/v1/cities/{city_id}/events?after_version=41&limit=100
```

`view=agent` 返回压缩后的决策信息，而非渲染器的全部顶点或图片数据：

```json
{
  "city_id": "city_01J...",
  "city_version": 42,
  "ruleset_version": "magic-london-mvp@1",
  "turn": 12,
  "resources": { "coins": 510 },
  "counts": { "buildings": 7, "roads": 31, "pending_orders": 1 },
  "needs": [
    { "kind": "residential", "pressure": 0.72, "reason": "service capacity exceeds nearby housing" }
  ],
  "recent_changes": [],
  "available_actions": {
    "define_district": true,
    "cancel_district": true,
    "construct": true,
    "connect": true,
    "request_asset": true
  },
  "links": {
    "playbook": "/agent/playbook.md",
    "spatial_query": "/api/v1/cities/city_01J.../spatial",
    "buildings": "/api/v1/cities/city_01J.../buildings",
    "events": "/api/v1/cities/city_01J.../events?after_version=42"
  }
}
```

### 6.2 查询某个地块范围有什么

```http
GET /api/v1/cities/{city_id}/spatial?min_col=10&min_row=18&max_col=20&max_row=28
GET /api/v1/cities/{city_id}/cells/{cell_id}
```

可用 `include=buildings,roads,nodes,fields` 控制展开。范围有最大面积限制；大地图以后用分页/分块，不能让 Agent 无界扫描。

响应至少包含：地形与建设约束、占用、基础设施、语义节点、局部 Field 摘要，以及引用建筑的稳定 ID。

### 6.3 检索建筑在哪里

```http
GET /api/v1/cities/{city_id}/buildings?query=草药&limit=20
GET /api/v1/cities/{city_id}/buildings?archetype=starter_residence&district_id=...
GET /api/v1/cities/{city_id}/buildings/{building_id}
```

第一版搜索覆盖：名字、archetype、purpose、tags、asset ID、所在 bbox 和建造状态。返回 `footprint_cells`、入口方向、连接摘要和当前资产；不依赖向量数据库。以后建筑故事增多后再增加语义检索。

### 6.4 查询候选地块

Agent 开始一组新建设前，先创建一个只有名字、用途和空间范围的轻量发展片区。服务端会把范围拆成 block-sized 分析单元，并返回软性的尺度参考：通常 24--48 个可建设格、短边 5--6 格、长边 6--8 格，常见是 1--2 个 block。`4x8` 仍然可以用于狭长住宅街，`5x6`、`6x6`、`6x8` 也都合理；这些不是限制，较大或特殊形状的范围仍然合法：

```http
POST /api/v1/cities/{city_id}/districts
```

片区不是用途禁令；它只是让 Agent 在后续轮次保持同一个空间意图。道路属于独立的城市道路网络，通常位于 block 外围；一条主路可以同时作为两侧 block 的共享边界。街区返回的建筑统计会在读取时把范围内已有建筑纳入，不需要回写或改绑建筑的 `district_id`；因此先建建筑、后划街区也能得到正确统计。返回中的 `layout`、`block_progress`、`observations`、`suggestions` 和 `composition_review` 都是规划反馈，不会因为尺寸、道路形状或未闭合而拒绝合法动作。正常思路是“划片 → 确保接入城市 → 按空间意图组织道路和建筑”，不要求每个 block 先完成一圈道路。

如果当前规划方向不再合适，可以取消规划关系而不破坏城市内容：

```http
POST /api/v1/cities/{city_id}/districts/{district_id}/cancel
```

```json
{
  "expected_city_version": 12,
  "reason": "把下一片发展转移到河岸入口"
}
```

取消后街区仍会保留在 Agent 的历史列表中，但 `status` 变为 `cancelled`；它不会再出现在玩家城市可视化的可选街区中。已经建好的建筑、道路、桥梁、资源和事件全部保留；该街区不再提供新的规划建议，也不能继续用于 site-search 或 construction order。需要继续发展时创建新的街区，或者在明确不属于任何规划街区时省略 `district_id`。

```http
POST /api/v1/cities/{city_id}/site-searches
```

```json
{
  "district_id": "district_123",
  "footprint": "1x2",
  "limit": 100
}
```

这是现有 `findCandidateParcels` 的服务化版本。服务只筛选合法占地并使用片区的持久化范围，不计算或返回地块分数。每个候选返回客观事实，包括合法入口方向、精确临路方向、最近道路距离、地形摘要和所在 block 的 `blockId` / `blockRole`，以及边界道路覆盖和 `recommendedForBlockFill` 规划参考，由 Agent 自己做组合与取舍。所有这些字段都是提示，不是施工前置条件。

### 6.5 资产搜索与生产决策

```http
GET  /api/v1/assets?archetype=starter_residence&footprint=1x1&style=willow_magic
POST /api/v1/asset-jobs
GET  /api/v1/asset-jobs/{job_id}
```

Agent 的显式决策有两种：

```json
{ "mode": "reuse", "asset_id": "starter-cottage-001" }
```

或：

```json
{
  "mode": "produce",
  "spec": {
    "archetype": "residence",
    "footprint": "1x1",
    "district_style": "willow_magic",
    "patterns": ["quiet_front_garden", "warm_lantern_rhythm"],
    "creative_brief": "一栋被月光花包围的窄砖屋"
  }
}
```

推荐默认 `reuse_preferred`：服务返回匹配分、差异和生产预计成本，Agent 只有在现有资产不能表达城市意图时才选择 `produce`。这同时控制成本，并让“新资产”成为有意义的城市事件。

### 6.6 建筑预览与提交

```http
POST /api/v1/cities/{city_id}/construction-previews
POST /api/v1/cities/{city_id}/construction-orders
GET  /api/v1/cities/{city_id}/construction-orders/{order_id}
```

请求沿用现有 proposal 语义，但将资产选择变成显式联合类型：

```json
{
  "expected_city_version": 42,
  "actor_note": "住宅压力升高，先补充靠近工坊的住房",
  "site": {
    "lot_id": "cell-22-19",
    "footprint": "1x1",
    "entrance": "south"
  },
  "program": {
    "archetype": "starter_residence",
    "purpose": "residential",
    "name": "月藤小屋",
    "attributes": {}
  },
  "design": {
    "district_style": "willow_magic",
    "patterns": ["quiet_front_garden"]
  },
  "asset": {
    "mode": "reuse",
    "asset_id": "starter-cottage-001"
  },
  "connection": {
    "target": { "kind": "node", "id": "old_town_entry" },
    "mode": "road"
  }
}
```

预览不改状态，返回：可行性、占地、路线、桥梁、成本、资源余量、警告、预览所基于的 `city_version` 和短期 `preview_token`。

提交时需要：

```http
Idempotency-Key: agent-run-2026-07-22-build-01
If-Match: "city-version-42"
```

如果复用资产且校验通过，订单可以立即 `completed`。如果生产新资产，订单进入：

```text
awaiting_asset -> asset_validating -> ready_to_build -> completed
                                  \-> failed
```

地块在等待期进入 `reserved`，资源采用明确策略：MVP 建议提交时冻结预计成本，完成时结算，失败时释放。前端可以显示施工围挡或代理体块。

### 6.7 道路预览与提交

```http
POST /api/v1/cities/{city_id}/connection-previews
POST /api/v1/cities/{city_id}/connections
```

端点是同一个联合类型，因此支持题目要求的建筑或地块：

```json
{
  "expected_city_version": 43,
  "from": { "kind": "building", "id": "building_123" },
  "to": { "kind": "cell", "id": "cell-30-21" },
  "mode": "road",
  "priority": "resident_access"
}
```

`kind` 初期支持 `building | cell | node`，未来可增加 `district | station | road_segment`。服务端负责把语义端点解析为入口候选并求解具体路径。Agent 不上传任意逐格路线；以后若允许建议路线，也只能作为软约束 waypoint。

### 6.8 命令结果和稳定错误

所有修改请求使用统一 envelope：

```json
{
  "command_id": "cmd_01J...",
  "status": "completed",
  "city_version_before": 42,
  "city_version_after": 43,
  "events": ["evt_01J..."],
  "resource": { "kind": "building", "id": "building_123" },
  "links": {}
}
```

重点错误码：

- `CITY_VERSION_CONFLICT`：重新读取城市后再预览；
- `IDEMPOTENCY_KEY_REUSED`：同一键对应了不同请求；
- `LOT_OCCUPIED` / `FOOTPRINT_INVALID`；
- `INSUFFICIENT_RESOURCES`；
- `NO_ROUTE`；
- `ASSET_NOT_COMPATIBLE`；
- `ASSET_JOB_LIMIT_REACHED`；
- `CAPABILITY_REVOKED` / `SCOPE_REQUIRED`。

## 7. 持久化模型

建议 PostgreSQL 从第一版开始使用。核心表：

| 表 | 作用 |
| --- | --- |
| `players` | 玩家账户 |
| `cities` | 城市元数据、规则版本、当前版本/回合 |
| `city_memberships` | 所有者及未来协作者权限 |
| `agent_credentials` | token 哈希、scope、限制、撤销和最后使用时间 |
| `city_cells` | 每城地块当前投影、占用和约束；主键 `(city_id, cell_id)` |
| `buildings` | 建筑当前投影、program/design/asset/status |
| `building_cells` | 建筑与占地单元关系 |
| `infrastructure` | 道路、桥、步道等当前投影 |
| `city_events` | 不可变事件；按 `(city_id, city_version)` 唯一排序 |
| `construction_orders` | 建设长事务与冻结资源 |
| `asset_definitions` | 可复用资产 registry 与兼容性 metadata |
| `asset_jobs` | 资产生产状态机、重试、错误和产物引用 |
| `command_receipts` | 幂等键、请求摘要、结果和响应缓存 |
| `agent_action_log` | actor、理由、命令、耗时、结果，供玩家审计 |
| `rulesets` | 数据驱动的游戏定义版本 |

50×50 地图只有 2500 格/城，第一版关系表足够。空间查询主要是整数网格 bbox，不需要立即引入 PostGIS。道路可以同时保留：

- `infrastructure` 中的语义道路对象；
- `city_cells.infrastructure_id` 的快速占用投影；
- 道路对象内有序的 cell path。

这样渲染、寻路和“这条路连接了什么”都可回答。

### 7.1 城市存档与升级

每座城市记录：

- `state_schema_version`：存储结构版本；
- `ruleset_id` / `ruleset_version`：玩法定义版本；
- `map_recipe_version` 与 seed：地图可复现；
- `city_version`：每次成功领域命令递增；
- 可选压缩快照：用于恢复和调试。

规则升级不能静默改变旧城市。采用显式 migration：备份快照、dry-run、升级、写入 `CityRulesetMigrated` 事件；失败可回到升级前快照。

## 8. 一致性、并发和异步任务

### 8.1 幂等

Agent 和网络都可能重试。所有 POST 命令必须有 `Idempotency-Key`：

- 相同 key + 相同请求：返回第一次结果；
- 相同 key + 不同请求：409；
- 记录按 credential + endpoint + key 隔离。

### 8.2 乐观并发

预览基于明确 `city_version`。提交时版本不一致则 409，不自动在新地图上套用旧方案。这样 Agent 不会在另一个行为已经占地后误建。

### 8.3 Transactional outbox

数据库事务同时写城市状态、事件和 outbox。worker 领取 outbox 后执行资产生产、日报或通知，保证“城市已记录任务但队列消息丢失”不会发生。

任务带租约、指数退避、最大重试和 dead-letter 状态。外部模型调用不得放在数据库事务内。

## 9. 规则和玩法的扩展方式

后续机制通过四类稳定插件点增长：

```text
Definition：建筑、卡牌、植物、政策、Field 的数据定义
Command：玩家或 Agent 想做什么
System：回合/时间推进时如何更新状态
Projection：给玩家、Agent、渲染器分别怎样阅读
```

例如加入“打人柳”：

1. 新增 `plant.whomping_willow` definition；
2. `PlaceWorldSeed` 命令生成节点和危险/自然 Field；
3. 选址评分与道路代价读取该 Field；
4. Agent snapshot 暴露“高危险绕行区”；
5. 渲染投影选择对应资产。

无需修改认证、幂等、城市版本或资产任务基础设施。

规则定义应有 JSON Schema 校验和版本号，但“规则执行代码”仍在受测模块中；不要在第一阶段允许用户上传任意脚本。

## 10. 安全和运营底线

- 只存 token 哈希，接入 token 仅展示一次；
- 所有写操作记录 credential、IP/调用来源、理由和结果；
- 限速按 credential、玩家和城市三层执行；
- Agent 不能越权读别的城市，列表查询也必须带城市过滤；
- `creative_brief` 是数据，不是服务器系统指令；生产 prompt 在服务器模板中合成；
- 外部资产 URL 不由 Agent 任意指定，避免 SSRF；
- 每个城市设置资源、每日动作与资产生产硬上限；
- 管理员操作与 Agent 操作使用不同凭证和 scope；
- 日志不记录 bearer token、完整接入链接或模型密钥；
- 数据导出、删除、备份和凭证撤销在上线前必须可用。

## 11. 可观测性与可解释性

每次 Agent 行为应串起：

```text
agent_run_id -> HTTP request -> command_id -> city event(s) -> asset job / order
```

最低指标：

- 命令成功率、409 冲突率、重复幂等命中；
- 预览到提交转化；
- 无路线/占地/资源不足等拒绝原因；
- 资产复用率、新资产生产耗时与失败率；
- 每城数据库行数和 snapshot 大小；
- Agent 从打开专属链接到第一次成功建设的耗时。

给玩家看的建设日志基于确定性事件，再由 LLM 可选润色。原始事实和润色文本分开保存，避免日报成为唯一事实来源。

## 12. 推荐目录结构

保留现有 Vite 前端，新增 workspace packages：

```text
apps/
  web/                   # 当前 Three.js/Vite UI 的逐步迁移目标
  server/                # HTTP、认证、应用服务、文档入口
  worker/                # 第二阶段再独立；初期可由 server 内 worker 运行
packages/
  city-engine/           # 纯规则、命令、事件、求解器
  contracts/             # API/domain schema、生成的类型
  content-magic-london/  # archetype、patterns、规则集与地图配方
  asset-pipeline/        # registry、job 状态机、生产适配器
docs/
  AGENT_CITY_SERVICE.md
  agent-playbook.md       # 未来由 server 原样发布
```

迁移期间不要一次移动所有渲染代码。先把 `src/city` 抽成可由浏览器与服务端共同导入的纯包，再逐步移动前端。

建议技术基线：

- Node.js + TypeScript；
- Fastify（HTTP、JSON Schema、OpenAPI）；
- PostgreSQL；
- SQL migration + 轻量 query layer；
- Zod 或 TypeBox 只选一个，作为合同单一来源；
- 初期 PostgreSQL outbox/job 表，负载出现后再引入专用队列；
- S3 兼容对象存储保存资产产物。

具体库可在实现开始时确认；领域合同和 API 形状不依赖这些选型。

## 13. 分阶段实施路线

### Phase 0：冻结合同与提炼引擎（约 3–5 个开发日）

**实现状态：完成。**

- 给现有状态、proposal、道路 endpoint、命令和事件补 schema；
- 时间和 ID 生成可注入，保证测试确定性；
- 把 `submitConstruction` 拆为纯预览 + 纯命令执行；
- 道路端点扩为 building/cell/node；
- 保持现有前端和测试继续运行。

验收：同一 state + command 必须产生同一结果；浏览器不再是状态唯一持有者。

### Phase 1：单城市 HTTP 垂直切片（约 5–8 个开发日）

**实现状态：完成。**

- server、PostgreSQL migration、城市 seed/import；
- 城市摘要、空间查询、建筑检索；
- 候选地块、建设预览/提交、道路预览/提交；
- OpenAPI、playbook、统一错误、幂等和 city_version；
- 先使用开发 token。

验收：curl 或测试 Agent 能从空白城市建两栋房并连接道路，重试不会重复扣费。

### Phase 2：多玩家与专属 Agent 接入（约 4–6 个开发日）

**实现状态：完成。**

- 玩家、城市、membership；
- 一次性 capability link、token scope、撤销/轮换；
- 城市创建、列表、独立存档；
- 审计日志、配额和越权测试。

验收：两个 Agent 使用不同链接时只能看到和修改各自城市；撤销后立即失效。

### Phase 3：资产选择与异步生产（约 6–10 个开发日）

**实现状态：完成。** 正式自动 provider 使用 TokenHub 的 `hy-image-v3.0`：框架图与 Magic London 风格参考生成白天关灯 RGB，再执行结构锁定的开灯配对编辑，并用跨平台差分派生 emissive。生产服务不依赖 Apple Vision。Qwen 保留为回退 provider，未配置自动生成密钥时使用 `codex-manual` 桥接。所有方式都在注册前执行 RGB/mask/depth/normal 派生与 manifest 校验。

- 资产搜索和匹配解释；
- `reuse` / `produce` 联合合同；
- construction order、地块预留、冻结资源；
- outbox worker、现有生产脚本适配、自动验收、registry 发布；
- 前端显示 awaiting/failed/completed。

验收：复用资产可同步完成；新资产任务失败不会留下永久占地或丢失资源。

### Phase 4：每日 Agent 循环和游戏扩展（后续）

- 城市需求/Field/卡牌/政策规则集；
- 定时 tick 与 Agent run budget；
- 增量事件、申请/审批、日报；
- 玩家控制 Agent 偏好与行动权限。

验收围绕核心乐趣：玩家的一次选择必须在城市结构、Agent 行为和日报事实中产生一致且可见的后果。

## 14. 第一轮实现明确不做

- 微服务拆分、Kafka、Kubernetes；
- GraphQL 和任意自然语言查询接口；
- Agent 直接提交坐标路径或执行服务器脚本；
- 完整向量检索、PostGIS、实时多人协同编辑；
- 完整事件溯源和跨规则版本任意回放；
- 把 LLM 放进每次合法性判断或寻路；
- 在 HTTP 请求内同步等待图像/3D 模型生产完成。

## 15. 开工前需要锁定的三个产品选择

这些选择不阻塞 Phase 0 的引擎提炼，但应在 Phase 1 前锁定：

1. **已锁定：Agent 能无审批花掉当前全部预算。** 预算不是硬性每日额度；城市收入在回合被 cooldown 闸门解锁后，由 Agent 主动 resolve 时按现有建筑产值统一结算。手动 `time-advances` 已禁用。重大项目以后可以作为额外玩法加入审批，但不阻挡普通 Agent 行动。
2. **已锁定：新资产等待期间冻结地块与预计成本。** 完成时结算；取消或生产失败时释放地块并返还冻结资源。
3. **已锁定：城市默认私有。** 未来另设可撤销的参观链接，不复用 Agent 写权限链接。

## 16. 当前代码到目标架构的对应关系

| 当前实现 | 保留与演进方向 |
| --- | --- |
| `src/city/state.js` | 变为可版本化的 CityState 与纯状态迁移 |
| `src/city/contracts.js` | 变为共享 schema/类型；去掉 `Date.now()` 等非确定性默认值 |
| `src/city/solver.js` | 继续作为确定性选址/路径核心，补评分解释和通用 endpoint |
| `src/city/workbench.js` | 拆为 command handler；内存闭包由 repository/application service 替代 |
| `src/city/assets.js` | 变为持久化 registry 的内置 seed 数据和查询接口 |
| `src/city/scenarios.js` | 变为地图/城市初始化 fixture 与集成测试场景 |
| `src/main.js` 的 `window.MAGTOPIA` | 保留为本地调试 facade，正式前端改调 HTTP API |

第一刀应落在“纯引擎合同”而非直接添加 Express/Fastify route。只有当同一命令能在浏览器测试和服务端测试中复用，网络服务才不会逐渐产生第二套城市逻辑。
