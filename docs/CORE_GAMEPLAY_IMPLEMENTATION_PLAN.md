# MAGTOPIA Core Gameplay Implementation Plan

> 目标：把 `CORE_GAMEPLAY_DESIGN.md` v0.3 拆成可独立实现、可独立验证、可逐步合入的开发阶段。
>
> 原则：先建立稳定的玩法数据与纯 Simulation，再接真实回合、卡牌和 UI。不要在单个 PR 中同时重写 schema、经济、事故、卡牌和前端。

## 0. 总体迁移原则

当前仓库仍保留旧玩法语义，例如整栋建筑 `category / magicLevel / concealment / jobs`、旧资源模型以及部分旧回合逻辑。v0.3 不应继续在旧模型上叠参数，而应按新的功能单元模型迁移。

必须坚持：

1. 建设、道路、district/block、体素生成与玩法 Simulation 分层。
2. Gameplay 只读取稳定的建筑功能语义，不读取 renderer / mesh 状态。
3. 建筑玩法计算按实际功能单元/功能格聚合，而不是只按整栋建筑类别或 footprint。
4. 系统负责资源、人口、风险、随机数、incident outcome 和 TurnFacts；Agent 负责规划、选择、派遣与叙事。
5. 每个阶段必须有 deterministic tests 和可复现小场景。
6. 每个 PR 尽量只建立一个新的 invariant，避免“大功能基本能跑但无法定位问题”。
7. wall clock 只控制下一回合最早开放时间，不能自动推进或结算游戏。

---

# 1. 六个实施阶段

## Phase 1 — Gameplay Schema + Functional Unit Foundation

### 目标

先把最底层玩法语义改对。此阶段不做 incident、不做卡牌、不做 UI。

### 核心规则

固定 5 类 gameplay purpose：

```text
residential
commercial
public_service
production
greenhouse
```

`magicRatio` 只允许：

```text
0 / 0.25 / 0.5 / 0.75 / 1
```

功能面积按实际功能单元累计，必须包含垂直楼层：

```text
functionalArea = Σ actual functional cells across floors / masses
```

示例：

```text
2 footprint cells × 3 residential floors
=> residential functionalArea = 6

2 footprint cells
- ground floor commercial
- upper 2 floors residential
=> commercial = 2
=> residential = 4
```

公共建筑可按 cell / mass 分配 purpose，例如主体 `public_service` + 温室翼 `greenhouse`。

### 建议代码边界

`src/gameplay/schema.js`

- purpose enum
- magicRatio normalize
- functional unit schema
- GameplayBuilding normalize / validate

`src/gameplay/building-metadata.js`

重写旧整栋 category 推导。输出应以聚合后的 functional breakdown 为核心，例如：

```js
{
  functionalAreas: {
    residential: 4,
    commercial: 2,
    public_service: 0,
    production: 0,
    greenhouse: 0,
  },
  units: [
    { purpose: 'commercial', area: 2, magicRatio: 0.25 },
    { purpose: 'residential', area: 4, magicRatio: 0.5 },
  ]
}
```

不要再把 `jobs`、generic `concealment`、generic `magicOutput` 当核心 metadata。

### 建造成本

第一版基础成本/功能格：

```text
residential    50 coins
commercial     60 coins
public_service 70 coins
production     80 coins
greenhouse     90 coins
```

普通民房允许轻微高度倍率：

```text
1F 1.00x
2F 1.05x
3F 1.10x
4F 1.15x
...
```

道路：

```text
standard road 2 coins / cell
bridge        ~15 coins / cell (provisional)
```

### 验收

给定普通民房、混合用途民房和复合公共建筑，系统能够确定性得到：

- 各 purpose functionalArea
- 每个功能单元 magicRatio
- 总建造成本
- 相同输入始终得到相同结果

### 推荐 PR

**PR A — gameplay schema + functional unit normalization**

**PR B — building aggregation + construction cost migration**

---

## Phase 2 — Economy + Population + Public Service

### 目标

完成一个没有 incident 也能自己运转的小镇 Simulation。

完成后应能实现：

```text
Agent 建设
→ 住房形成
→ 人口逐步迁入
→ 金币 / Arcane Energy 生产
→ public service 改善入住率
→ 下一轮继续扩张
```

### 资源

玩家核心资源只保留：

```text
coins
arcaneEnergy
```

初始：

```text
coins = 600
arcaneEnergy = 0
```

### 住宅

每 residential functional unit：

```text
4 people capacity
```

按 magicRatio 切分容量：

```text
0    -> 4 Muggle / 0 Wizard
0.25 -> 3 / 1
0.5  -> 2 / 2
0.75 -> 1 / 3
1    -> 0 / 4
```

收入基于实际居民，不基于容量：

```text
2 coins / resident / turn
0.25 Arcane Energy / wizard resident / turn
```

人口只能逐步向 supported capacity 靠近；容量降低时同样逐步迁出。

### 其他 purpose 产出

每 functional unit / turn：

```text
commercial:
  12 coins
  1 × magicRatio Arcane Energy

public_service:
  0 coins
  0 Arcane Energy by default

production:
  18 coins
  4 × magicRatio Arcane Energy

greenhouse:
  12 coins
  6 × magicRatio Arcane Energy
```

Arcane Energy 内部允许小数。

### Public Service

半径：

```text
5 cells
```

公共服务不依赖 district / block。

基本目标：

- 无服务时附近住宅最大入住率约 50%
- 正常服务后约 75–80%
- 90–100% 不在 MVP 中硬编码成简单堆 public cells 即可达到

第一版可用：

```text
serviceCapacity = nearbyPublicServiceCells × 4
serviceCoverage = clamp(serviceCapacity / nearbyResidentialCells, 0, 1)
```

但公式必须封装为独立纯函数，方便后续调参。

迁入速度概念目标：

```text
no service      ~25% of remaining gap / turn
normal coverage ~40%
```

### 验收

建立一个纯 Simulation 小镇，连续跑 10–20 turns：

- 人口不会瞬间填满
- public service 明显影响迁入与入住率
- coins 能从初始资本逐步过渡到城市自身收入
- greenhouse 明显推动 Arcane Energy
- production 比 greenhouse 更偏 coins
- vertical density 的功能面积与产出正确

### 推荐 PR

**PR C — economy + population settlement**

**PR D — public service radius + migration support**

---

## Phase 3 — Unified Spatial Exposure

### 目标

先让系统可以解释：

> 每栋魔法建筑当前为什么危险，周边城市布局又为什么能把风险压下来。

此阶段暂时只计算 risk，不真正生成 incident。

### MagicLoad

系统固定 purpose intensity：

```text
residential    1x
commercial     2x
public_service 3x
production     4x
greenhouse     4x
```

开放空间型 public service（广场、庭院、柱廊、开放花园等）：

- 不提供 magicRatio 选项
- MagicLoad = 0
- 其占地仍进入局部空间分母

建筑/功能源负载：

```text
MagicLoad = Σ(functionalArea × magicRatio × typeIntensity)
```

### 局部魔法浓度

对每个风险源建筑 i：

```text
LocalMagicRatio_i =
Σ[w(distance_ij) × area_j × magicRatio_j]
/
Σ[w(distance_ij) × area_j]
```

范围约 5 cells，距离快速衰减。具体 weight curve 独立封装，先以直觉合理为目标。

普通住宅、商店、庭院、广场等通过增加分母自然降低局部魔法浓度；不再使用旧 generic `concealment +X`。

### Base Risk

基础风险锚点：

```text
low    2%
medium 5%
high  10%
```

最终风险：

```text
finalIncidentChance = baseRisk × spatialModifier(LocalMagicRatio)
```

第一版 modifier 目标锚点可近似：

```text
20% local magic  -> ~0.3
40%              -> ~0.5
60%              -> ~0.7
80%              -> ~0.9
100%             -> ~1.0
```

### 验收

至少准备 deterministic spatial fixtures：

1. 独立高魔法 greenhouse 风险高。
2. 同一 greenhouse 被普通住宅/商业包围后风险下降。
3. 加入庭院/广场后风险进一步下降。
4. 纯魔法设施密集聚集时风险接近裸风险。
5. 不依赖 block / district 边界。

### 推荐 PR

**PR E — spatial exposure + risk inspection**

---

## Phase 4 — Incidents + Arcane Officers

### 目标

完成完整治理闭环：

```text
magic development
→ exposure risk
→ per-building incident roll
→ Agent assignment
→ system d20 resolution
→ historical consequence
```

### Incident generation

每栋存在 MagicLoad 的建筑每回合独立 roll。

不要设置 citywide incident count cap。

期望事件量：

```text
expected incidents = Σ finalIncidentChance_i
```

### Incident types

```text
investigation
suppression
cover_up
```

对应 Arcane Officer 能力：

```text
Investigation
Suppression
Cover-up
```

事件来源 purpose、magicRatio、final risk 和随机数共同影响事件 type / difficulty，不要硬一一绑定。

### Difficulty

第一版：

```text
normal DC 10
hard   DC 14
severe DC 18
```

### Resolution

```text
d20
+ matchingOfficerSkill
+ specialtyBonus
+ otherModifiers
vs DC
```

结果：

```text
margin >= +5  critical_success
>= 0          success
<= -5         critical_failure
otherwise     failure
```

### Arcane Officer

每名 officer 有永久身份：

```text
name
appearanceSeed / visualRef
Investigation 0..5
Suppression   0..5
CoverUp       0..5
specialty
status
```

specialty 第一版与来源 purpose 对应：

```text
residential
commercial
public_service
production
greenhouse
```

匹配：

```text
+2
```

初始属性总和可控制在约 7–9，具体生成器保持可调。

每名 officer 每回合最多处理 1 个 incident。

Ministry of Magic 建成后解锁 officer recruitment / candidate pool。

候选池每隔若干回合提供 2–3 名命名候选人。招募成本和维护成本先通过配置项实现，不写死在调用层。

成长：成功处理事件后对应能力有小概率 +1，cap 5；critical success 可提高成长概率。

### Historical Risk

建筑初始：

```text
historicalRisk = 0
```

结果：

```text
failure          +1
critical_failure +2
```

达到：

```text
historicalRisk >= 4
```

进入 `sealed`。

sealed：

- 停止住房、coins、Arcane Energy、public service 等正常功能
- 建筑实体仍保留在地图
- 后续可扩展为 Urban Legend

不要在 MVP 中先做复杂恢复树。

### 系统随机数

集中在 `src/gameplay/random.js`：

- production 可真实随机
- tests 可注入 seed / deterministic roller
- TurnFacts 保存 raw roll、modifiers、total、DC、outcome
- Agent 不得提交 outcome 或最终骰值

### Agent assignment

系统暴露：

```text
pending incidents
available officers
```

Agent只提交：

```text
incidentId -> officerId
reason (optional narrative)
```

系统验证：

- officer 存在且可用
- 一人不能处理多个事件
- incident 尚未解决
- Agent 不能伪造 roll / outcome

### 验收

固定 seed 的同一城市连续运行必须完全可复现：

- 哪栋楼出 incident
- incident type / difficulty
- officer modifiers
- d20 roll
- outcome
- historicalRisk
- sealed state

### 推荐 PR

**PR F — independent incidents + deterministic resolution**

**PR G — Arcane Officer identities, recruitment, assignment and growth**

---

## Phase 5 — Turn Lifecycle + Bootstrap + Owl Daily

### 目标

在纯 Simulation 已稳定后，再接真实游戏生命周期。

### Turn cooldown

核心规则：

```text
nextTurnUnlockAt = turnOpenedAt + TURN_COOLDOWN_SECONDS
```

回合进入下一阶段需要同时满足：

1. Agent / 玩家正常流程已经完成；
2. 当前时间 >= nextTurnUnlockAt。

如果 Agent 工作时间超过 cooldown，完成后可立即进入结算。

如果 Agent 很早完成，就等待 unlock。

scheduler 可以检查 eligibility，但不得自动 resolve / advance gameplay。

禁止：

- wall clock 自动结束城市日
- catch-up turns
- offline chained simulation
- 改 cooldown 时同步改变经济/事故参数

短 cooldown 只是加速正式玩法节奏。

### Turn 0 Bootstrap

新城市流程：

```text
create city
→ return viewer_url
→ player can open empty city
→ no card choice
→ Agent connects old_town_entry
→ establishes first road / compact area
→ builds first residential + income buildings
→ resolve Bootstrap Turn 0
→ first Owl Daily
→ Turn 1 normal card choice
```

Turn 0 不发卡。

Bootstrap guidance 应是建议，不是僵硬脚本：

- 从 `old_town_entry` 接第一条主路
- 建基本临街结构
- 第一批低成本住宅/商业
- 可有少量公共服务
- 不要求先形成完整封闭 block

### TurnFacts

一次 turn resolve 后必须冻结不可变事实：

```text
turn
resourceDelta
populationDelta
buildingsStarted
buildingsCompleted
incidents
assignments
rolls
outcomes
historicalRiskChanges
sealedBuildings
cardChoiceApplied
```

Agent Owl Daily 只能基于事实写叙事，不得改变事实。

### UX phase

视觉阶段：

```text
DAWN
  Owl Daily
↓ dismiss
EARLY_MORNING
  card choice
↓ choose
MORNING
  waiting Agent
↓ first accepted meaningful Agent action
DAY
  building / management
↓
NIGHT
  incident strategy / resolution
↓
next DAWN
```

昼夜光照插值仅视觉，不影响 Simulation。

### 验收

- 改 wall clock 但不 resolve turn，不产生资源/人口变化
- scheduler 不能自行推进 turn
- fresh city 首次没有卡牌
- Bootstrap 后生成第一份日报
- return viewer 能恢复当前 phase，不重复发卡
- 同一 turn resolve 幂等

### 推荐 PR

**PR H — turn lifecycle + Bootstrap + TurnFacts / Owl Daily backend**

---

## Phase 6 — Cards + Special Choice + Frontend Integration

### 目标

把玩家的低频方向控制接入已经跑通的城市系统。

### Ordinary Choice

Turn 1 起，每个非 Special turn 都有 3 张基础卡：

```text
BUILDING
next ordinary building costs 80%

PEOPLE
immediately move residents into available supported housing
(base amount starts around +2, may scale mildly later)

RESOURCE
coins grant
(base starts around +20, may scale mildly with economy later)
```

三者必须保持功能差异：

- BUILDING 对大型建设更有价值
- PEOPLE 加速已有容量兑现
- RESOURCE 最灵活

普通卡允许 Agent 在授权条件下代选。

### Special Choice cadence

```text
every 5 turns
```

即：

```text
Turn 5  Special
Turn 10 Special
Turn 15 Special
...
```

Special Choice 的 3 张都必须足够有分量，不要只出现 1 张特殊卡 + 2 张基础卡。

### Turn 5 Ministry guarantee

第一次 Special Choice：

- Ministry of Magic 固定出现
- 直到玩家选择并完成建设前，每次 Special Choice 都继续出现
- 另外两张根据城市状态和 eligibility 生成

Ministry 卡不是免费凭空生成建筑，而是：

```text
unlock / grant special build opportunity
→ Agent chooses placement
→ city pays normal or card-defined discounted cost
→ building completes
→ Arcane Officer system unlocked
```

### Special card families

可来自：

```text
special building
rare person / officer
large resource burst
multi-turn modifier
```

不要强制每次严格“一张建筑 / 一张人 / 一张资源”，只要求：

- 三张都符合当前城市状态
- 三张之间有真实路线差异
- 不出现未解锁系统的死卡

例如：

```text
Ministry of Magic
Royal Botanical Greenhouse
+180 coins city grant
```

### Eligibility

至少包括：

- unique building 不重复
- officer cards 需要 Ministry / officer system 可用
- 高阶 Arcane 项目需要城市已有对应经济基础
- 城市过小时不出现明显中后期设施
- affordability / prerequisite 应进入 candidate filtering

### Frontend

最后再接：

- Owl Daily
- ordinary card layout
- Special Choice visual distinction
- portrait: vertical cards
- landscape: horizontal cards
- waiting Agent phase
- restored phase after reopening
- officer candidate / incident factual views

### 验收

走完整：

```text
Turn 0 Bootstrap
Turn 1–4 ordinary choice
Turn 5 Special Choice
Turn 6–9 ordinary choice
Turn 10 Special Choice
```

玩家即使只在 Special Choice 主动介入，Agent 也能让城市连续发展。

### 推荐 PR

**PR I — cards, eligibility and 5-turn Special Choice**

**PR J — frontend integration and end-to-end playable loop**

---

# 2. 推荐 PR 序列

最终建议按约 10 个 PR 推进：

```text
A. gameplay schema + functional units
B. building aggregation + construction cost
C. economy + population
D. public service + migration
E. spatial exposure
F. incidents + deterministic d20 resolution
G. Arcane Officers
H. turn lifecycle + Bootstrap + TurnFacts / Owl Daily backend
I. cards + Special Choice
J. frontend integration + E2E
```

依赖关系：

```text
A
↓
B
↓
C
↓
D
↓
E
↓
F
↓
G
↓
H
↓
I
↓
J
```

允许在稳定接口确定后并行做少量 UI skeleton，但不要让 UI 成为 gameplay contract 的定义者。

---

# 3. 每个 PR 的统一验收要求

所有 gameplay PR 默认要求：

1. 新规则有纯函数级单元测试。
2. 涉及随机数时必须支持固定 seed。
3. 不以 renderer / DOM / voxel mesh 为玩法权威来源。
4. 不引入新的 timber / stone 玩法依赖。
5. 不允许 Agent 直接提交系统事实、随机数或 outcome。
6. 同一 command / resolve 重试不得重复扣资源或重复结算。
7. 测试必须包含至少一个接近真实城市的小 fixture，而不是只测单变量函数。
8. 所有临时常量集中配置，避免散落 magic numbers。
9. 若该阶段尚未实现后续系统，应返回明确的未实现状态，而不是偷偷沿用旧玩法规则。

---

# 4. Simulation Harness

在 Phase 2 完成后建立轻量 simulation harness；Phase 3–4 持续扩充。

目标不是做正式游戏工具，而是快速跑：

```text
10 turns
20 turns
50 turns
```

输出：

```text
coins
Arcane Energy
muggle / wizard population
functional area by purpose
public service coverage
average / max incident chance
incident count
officer utilization
historicalRisk distribution
sealed buildings
```

用途：

- 检查早期经济是否卡死
- 判断普通卡 +20 是否随规模失效
- 判断 Arcane Energy 是否过慢/过快
- 检查 incident 数量是否随城市规模合理增长
- 检查 officer staffing 是否形成真实压力

不要在规则尚未稳定前开发复杂可视化 dashboard；文本/JSON/简单表格足够。

---

# 5. 第一阶段开发顺序

合入本设计基线后，第一个开发 PR 应只做：

> **PR A — gameplay schema + functional unit normalization**

明确不做：

- economy settlement
- population migration
- public service
- exposure
- incidents
- officers
- cards
- turn scheduling
- UI

PR A 的目标仅仅是证明：

> 无论 Agent 使用普通民房楼层 grammar，还是公共建筑 cell/mass grammar，Gameplay 层都能得到统一、稳定、可验证的功能单元表达。

这个接口稳定之后，后续所有经济、人口、风险和事故公式才有可靠基础。
