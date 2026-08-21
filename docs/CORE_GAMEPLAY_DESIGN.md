# MAGTOPIA（麦托邦）核心玩法设计

## 文档状态

- 版本：v0.3
- 状态：当前核心玩法权威基线
- 适用范围：Simulation、服务端、Agent、前端、卡牌与内容设计
- 目标：先跑通一条轻操作、Agent 主导、城市会积累历史的完整核心循环
- 实施拆解见：[CORE_GAMEPLAY_IMPLEMENTATION_PLAN.md](CORE_GAMEPLAY_IMPLEMENTATION_PLAN.md)

> 本版本重点收敛了新城 Bootstrap、功能格经济、人口与公共服务、秘能、建筑级暴露、Incident、秘法官、普通卡与每 5 回合 Special Choice。
>
> 本文中的数值除明确标注“已锁定”的部分外，均视为 MVP 第一版调参基线；后续允许通过模拟器和真实 Agent playtest 调整，但不应随意改变系统语义。

---

## 1. 核心体验

MAGTOPIA 是一款由 AI Agent 驱动的魔法城市建设游戏。

玩家不负责日常微操，而负责少量高影响方向选择；Agent 负责城市规划、道路、建筑、功能组合、资源配置、风险治理和日报解释。

核心体验是：

> 玩家与一个真正负责经营城市、会判断、会成功也会失败、并会回来汇报的 Agent，共同生活在一座持续成长并积累历史的城市中。

城市本身应同时存在两套互相连接但不完全重合的经济：

- 普通城市经济：人口、税收、商业、生产，主要产出 `coins`；
- 巫师经济：巫师人口、魔法商业、生产、温室等，主要产出 `arcaneEnergy`（秘能）。

秘能不是幸福度、经验值或维护资源，而是大型魔法建设与高阶项目的战略资源。

魔法发展越快，暴露治理压力越高；优秀城市布局可以用普通城市肌理、庭院、广场、柱廊等空间自然稀释魔法暴露。

---

## 2. 回合与现实时间

一个游戏回合对应一个“城市日”。

现实时间只作为下一回合最早开放时间的 cooldown / unlock gate，不直接推进资源、人口或风险。

### 2.1 已锁定原则

- 系统不能因为现实时间过去而自动结束或推进玩法。
- 没有 catch-up turns，不做离线连续补算。
- Scheduler 可以唤醒或检查资格，但不能自己 resolve gameplay。
- Agent 的真实、被接受的动作才表示本回合已经发生推进。
- 快速测试模式只能缩短 cooldown，不能改变经济、概率、人口、成本和调参规则。

概念上：

```text
turnOpenedAt
nextTurnUnlockAt = turnOpenedAt + TURN_COOLDOWN_SECONDS
```

只有当：

1. 当前回合的正常 Agent / 玩家流程已完成；且
2. 当前时间已经达到 `nextTurnUnlockAt`

才允许进入下一回合。

---

## 3. 新城市：Turn 0 Bootstrap

新建城市后，不先给玩家卡牌。

Turn 0 的目标是让 Agent 先把一片真正可见、可理解的小城市建立起来。

推荐流程：

```text
create city
  ↓
Agent 返回可点击 viewer URL
  ↓
从 old_town_entry 建第一条主路
  ↓
建设第一批住宅 / 商业 / 公共服务
  ↓
允许少量魔法用途从一开始出现
  ↓
resolve Bootstrap Turn 0
  ↓
生成第一份 Owl Daily
  ↓
Turn 1 开始普通卡牌循环
```

Agent 新城引导必须明确：

- 空城没有“现有道路网络”；
- 第一条道路网络从 `old_town_entry` 开始；
- 不要求先围出 block 才能建设；
- district / block 可作为 Agent 自己的规划语义，但核心 gameplay 不依赖它们稳定存在。

---

## 4. 核心循环

普通回合：

```text
上一回合结算 / Owl Daily
  ↓
普通三选一（可由 Agent 代选）
  ↓
Agent 规划与建设
  ↓
人口迁移
  ↓
金币 / 秘能生产
  ↓
每栋有魔法负载的建筑独立 Incident roll
  ↓
Agent 分配秘法官
  ↓
系统掷骰并产生四档结果
  ↓
更新 historicalRisk / 封锁等事实
  ↓
冻结 TurnFacts
  ↓
Agent 基于事实写 Owl Daily
```

每 5 回合一次 Special Choice，替代普通卡。

---

## 5. Gameplay 功能粒度

视觉建筑语法与玩法功能必须解耦。

Agent 可以自由创造“宿舍、仓库、门房、档案馆、学院、魔药铺、温室翼”等叙事名称；系统不从自然语言名称猜玩法功能。

真正的玩法语义由少量固定枚举表示。

### 5.1 五类 gameplay purpose

MVP 只保留五类：

```text
residential
commercial
public_service
production
greenhouse
```

不保留 player-facing `mixed` 或 `support`。

### 5.2 粒度：功能格

公共建筑建筑语法不适合按楼层拆功能，因此统一采用“功能格”作为 Gameplay 计算粒度。

民房语法仍然可以自然表达多层用途；系统将每层/每格的实际功能转换为功能格面积。

例如：

- 2 格占地 × 3 层纯住宅 = 6 个 residential 功能格；
- 2 格占地 × 3 层，底层商店、上两层住宅 = 2 commercial + 4 residential 功能格；
- 一个 4 格公共建筑可以组合 2 public_service + 1 greenhouse + 1 其他公共空间。

所有经济、人口容量与建造成本都应以“实际功能面积”为口径，而不是只看建筑 footprint。

---

## 6. magicRatio

`magicRatio` 表示一个功能格中巫师世界用途所占比例，而不是“魔法威力”。

只允许五档离散值：

```text
0
0.25
0.5
0.75
1.0
```

禁止 Agent 输入任意连续值，例如 0.63、0.7。

建筑可以有默认 `magicRatio`，功能格允许 override；不 override 时继承默认值。

### 6.1 住宅人口拆分（已锁定）

每个 residential 功能格提供 4 人住房容量。

```text
housingCapacity = residentialFunctionalArea × 4
muggleCapacity = housingCapacity × (1 - magicRatio)
wizardCapacity = housingCapacity × magicRatio
```

因为 ratio 以 0.25 为步长，因此单格永远得到整数人口容量：

| magicRatio | 麻瓜容量 | 巫师容量 |
|---:|---:|---:|
| 0 | 4 | 0 |
| 0.25 | 3 | 1 |
| 0.5 | 2 | 2 |
| 0.75 | 1 | 3 |
| 1 | 0 | 4 |

实际人口不会瞬间填满，而是逐回合向受支持容量迁移。

---

## 7. 五类功能的职责

### 7.1 residential

- 提供住房容量；
- 不直接产生固定商业收入；
- 实际入住居民产生税收；
- 巫师居民额外产生少量秘能；
- 魔法活动基础强度：`1×`。

### 7.2 commercial

- 不提供住房；
- 稳定产出金币；
- 金币产出不因 magicRatio 增加而下降；
- 魔法部分额外提供少量秘能；
- 魔法活动基础强度：`2×`。

世界观上，巫师消费更高完全合理；MVP 暂不单独建需求模型。

### 7.3 public_service

- 不直接产金币；
- 不提供住房；
- 对一定半径内 residential 提供入住率与迁入速度支持；
- 特殊公共建筑可以附加系统解锁，例如魔法部解锁秘法官；
- 建筑型公共服务可以有 magicRatio；
- 建筑型魔法活动基础强度：`3×`。

广场、庭院、柱廊、开放花园等“空间型 public_service”不提供 magicRatio 选项，等价于 0 魔法负载；但其占地面积会进入局部空间分母，自然稀释附近魔法浓度。

### 7.4 production

- 不提供住房；
- 不提供公共服务；
- 直接产金币；
- 魔法部分显著产出秘能；
- 偏金币效率；
- 魔法活动基础强度：`4×`。

### 7.5 greenhouse

- 不提供住房；
- 不提供人口吸引加成；
- 产金币；
- 同面积、同 magicRatio 下，金币产量低于 production；
- 同面积、同 magicRatio 下，秘能产量高于 production；
- 魔法活动基础强度：`4×`。

其独立价值就是“牺牲部分金币效率换更高秘能效率”。

---

## 8. 第一版经济基线

以下为第一轮模拟基线，后续应通过脚本和 Agent playtest 调参。

### 8.1 每功能格 / 每回合产出

| purpose | 金币 | 秘能 |
|---|---:|---:|
| residential | 实际居民 × 2 | 实际巫师 × 0.25 |
| commercial | 12 | `1 × magicRatio` |
| public_service | 0 | 0 |
| production | 18 | `4 × magicRatio` |
| greenhouse | 12 | `6 × magicRatio` |

`public_service` 即使有 magicRatio，也默认不自动产秘能。使用魔法与“生产秘能”不是一回事。

### 8.2 建造成本基线

| purpose | 金币 / 功能格 |
|---|---:|
| residential | 50 |
| commercial | 60 |
| public_service | 70 |
| production | 80 |
| greenhouse | 90 |

民房多层建筑增加轻微高度成本，例如：

```text
1F: 1.00×
2F: 1.05×
3F: 1.10×
4F: 1.15×
...
```

目的不是惩罚高度，而是形成“低层便宜但占地、多层节省土地但略贵”的轻取舍。

### 8.3 道路

道路必须足够便宜，避免经济系统惩罚 Agent 做完整路网。

第一版基线：

```text
普通道路：2 coins / cell
桥：15 coins / cell
```

未来特殊道路可以有更高成本。

### 8.4 初始资源

新城市初始 spendable resource 只给金币：

```text
coins = 600
```

不需要 seed timber / stone。

---

## 9. 人口与公共服务

### 9.1 基础入住率

没有公共服务时，住宅并不是完全无法入住，而是只能达到约 50% 的长期入住率。

```text
baseMaxOccupancy = 50%
```

这样 public_service 具有明显价值，但不会形成硬锁。

### 9.2 服务半径

公共服务按空间半径计算，不依赖 block / district。

MVP 基线：

```text
serviceRadius = 5 cells
```

普通合理覆盖应能将附近入住率推到约 75–80%。

真正逼近 100% 不应靠简单堆叠 public_service 格，而应留给 Agent 通过更优秀的城市布局、特殊公共设施、政策等探索。

MVP 可以先保留一个简单 `serviceCoverage`，但不要把“满 coverage = 自动 100% 入住”写死成最终设计。

### 9.3 人口迁入 / 迁出

- 人口逐回合向当前受支持容量迁移；
- 无公共服务时迁入较慢；
- 有正常服务覆盖时迁入明显加速；
- 如果未来拆除住宅导致容量下降，人口逐回合迁出，不瞬间消失；
- 麻瓜和巫师使用同一套基础迁移逻辑，只是目标容量由 magicRatio 拆分。

---

## 10. 秘能（Arcane Energy）

玩家侧名称：`秘能 / Arcane Energy`。

秘能是巫师经济的战略建设资源，不是维护费、幸福度或经验条。

主要来源：

```text
巫师居民：少量基础产出
commercial：少量
production：大量
 greenhouse：最高效率
```

大量魔法建筑不应该都自动成为“发电站”。public_service 默认不生产秘能。

大型 / 高阶魔法建筑可以消耗累计秘能；普通小型魔法用途仍可主要依赖金币。

大多数大型魔法设施只需要轻量金币维护，不消耗持续秘能，避免巫师经济自锁。

---

## 11. 统一空间暴露模型

暴露按建筑计算，不依赖 block。

### 11.1 建筑自身魔法负载

每栋建筑先汇总其功能格：

```text
MagicLoad_i = Σ(functionalArea × magicRatio × typeIntensity)
```

其中：

```text
residential = 1×
commercial = 2×
public_service(building-type) = 3×
production = 4×
greenhouse = 4×
```

特殊 prefab 可以定义自己的 intensity，不强制落入四档。

### 11.2 LocalMagicRatio

在建筑周围固定半径内，按距离衰减计算局部魔法用途占比：

```text
LocalMagicRatio_i =
  Σ[w(d_ij) × Area_j × magicRatio_j]
  /
  Σ[w(d_ij) × Area_j]
```

- `w(d)` 随距离衰减；
- 超过影响半径视为 0；
- 广场、庭院、柱廊、普通麻瓜用途都有面积但 magicRatio 为 0，因此天然降低局部魔法浓度；
- 同一套函数同时表达“魔法聚集”与“普通城市掩护”，不再需要为每种建筑单独写 concealment +1/-1。

### 11.3 基础事故风险锚点

建筑自身风险先按魔法活动程度落在三个基础档：

```text
低风险：2%
中风险：5%
高风险：10%
```

周边空间模型只负责把风险往下修正。

概念上：

```text
finalIncidentChance = baseRisk × spatialModifier
```

其中 `spatialModifier` 可先控制在约 `0.2 .. 1.0`。

例如一栋裸风险 10% 的高魔法温室，如果嵌入大量普通用途、庭院和广场中，实际风险可以压到 2–5%；如果周围几乎全是高魔法生产，则接近 10%。

单建筑单回合事故概率上限约 10%。

---

## 12. Incident 生成

每栋有魔法负载的建筑，每回合独立进行一次 Incident roll。

不设置全城固定“事故预算”。原因是城市规模扩大后，事故压力必须自然推动秘法官编制增长。

```text
ExpectedIncidents = Σ incidentProbability_i
```

因此：

- 小城市低魔法 → 几乎没有事故；
- 大城市、平均暴露较高 → 每回合出现更多事故；
- 优秀布局可以降低平均风险，从而减少秘法官需求。

### 12.1 Incident 类型

MVP 固定三类，直接对应秘法官能力：

```text
investigation
suppression
cover_up
```

含义：

- `investigation`：来源未知、诅咒痕迹、异常反应、调查类；
- `suppression`：植物暴走、设备失控、实体威胁、生产事故；
- `cover_up`：麻瓜目击、照片录像、公开传播、现场善后。

来源建筑 purpose 影响类型权重，但不绝对绑定。

### 12.2 难度

MVP 三级：

```text
普通：DC 10
困难：DC 14
危急：DC 18
```

建筑当前暴露和 historicalRisk 可以影响难度分布：越高风险，越容易生成困难 / 危急事件。

---

## 13. 秘法官（Arcane Officer）

玩家侧职业名称：`秘法官 / Arcane Officer`。

秘法官不是匿名编制数字，而是长期存在的轻 RPG 角色。

每名秘法官有：

```text
name
portrait / appearanceSeed
investigation
suppression
coverUp
specialty
status
history
```

名字、形象与基础角色身份应固定。

### 13.1 三项能力

```text
Investigation
Suppression
Cover-up
```

能力范围建议 `0..5`，初始总点数控制在一个较窄区间，例如 7–9。

### 13.2 Specialty

MVP 先直接按五类来源：

```text
residential
commercial
public_service
production
greenhouse
```

匹配时第一版可给 `+2`。

### 13.3 招募与维护

- 需要先建成魔法部或对应治理设施；
- 招募消耗金币；
- 每回合有轻量金币维护；
- 不消耗秘能维护；
- 每名秘法官每回合只有 1 次 assignment。

第一版数量级可试：

```text
招募：120–180 coins
维护：8–12 coins / turn
```

巫师人口可以提供招募 / 编制软上限，但秘法官不能随人口自动生成。

### 13.4 候选池

魔法部建立后，每隔若干回合提供 2–3 名候选人，而不是点击按钮无限即时生成随机角色。

候选人拥有固定名字、形象、能力和 specialty，形成真正的招募选择。

### 13.5 成长

MVP 不做等级和技能树。

成功处理某类事件若干次后，对应能力可以有小概率 +1；大成功可提高成长机会；能力上限仍为 5。

角色成长应来自经历，而不是独立 RPG grind。

---

## 14. 秘法官处理 Incident

Agent 是派遣决策者，系统是随机数和事实结算者。

处理公式：

```text
d20 + relevantSkill + specialtyBonus + modifiers
vs DC
```

四档结果：

```text
roll - DC >= 5      -> critical_success
roll >= DC          -> success
roll < DC           -> failure
roll - DC <= -5     -> critical_failure
```

系统必须记录原始骰值、修正项、最终结果，保证可审计。

### 14.1 无人处理

如果 Incident 数量超过可用秘法官数量，未处理事件进入失败路径。

这使“根据城市当前暴露规模雇佣合适数量的秘法官”成为真实经营玩法。

### 14.2 空闲秘法官

如果某回合事故较少，未占用的秘法官可以被 Agent 分配到高风险建筑做预防性治理，降低其下一回合风险。

Agent 没有显式指派时，系统可以将空闲人员用于保守的自动 fallback，但 Incident 响应优先。

---

## 15. historicalRisk 与封锁

每栋建筑维护 `historicalRisk`，初始为 0。

已锁定 MVP 规则：

```text
failure          -> historicalRisk +1
critical_failure -> historicalRisk +2
historicalRisk >= 4 -> sealed
```

封锁后：

- 停止住房、金币、秘能和公共服务功能；
- 建筑继续留在地图上；
- 成为城市历史 / 都市传说地点；
- 后续可以给附近商业带来围观 / 旅游收益，但该反馈不是 MVP 核心依赖。

失败应该给城市留下历史，而不是简单删除建筑。

---

## 16. 卡牌：普通回合

Turn 0 没有卡牌。

除 Special Choice 外，每个正常回合都有一个轻量三选一；玩家可以选择，也可以授权 Agent 代劳。

三个方向固定为：建筑 / 人 / 资源。

第一版普通卡：

### 建筑

```text
下一栋普通建筑建造成本 8 折
```

### 人

```text
2 名居民立即迁入现有空置住房
```

仍不能突破住房容量和当前入住率上限。

### 资源

```text
+20 coins
```

后期普通奖励允许随城市规模轻微增长，避免 +20 coins 在成熟城市完全失效；具体缩放规则后续调参。

普通卡的目标是维持每日轻选择，不应迫使玩家每天深度参与。

---

## 17. Special Choice：每 5 回合

每 5 回合一次特殊三选一，替代当回合普通卡。

```text
Turn 5
Turn 10
Turn 15
...
```

Special Choice 默认是玩家本人需要关注的关键决策；如果玩家长期不操作或明确授权，Agent 才代选。

三张卡必须都具有阶段性价值，而不是“只有一张特殊卡夹在两张普通卡中”。

特殊方向仍然来自：

- 特殊建筑；
- 稀有人物；
- 大额资源 / 阶段性 buff。

### 17.1 第一次 Special Choice

Turn 5 固定至少出现“魔法部”。

如果玩家没有选择，魔法部会在后续 Special Choice 继续出现，直到玩家选择并建成。

原因：秘法官是基础风险治理闭环的重要系统，不能因为一次随机错过而永久锁死。

魔法部卡不是“免费凭空生成建筑”，而是给予特殊建造权 / prefab，由 Agent 选择位置并完成建设，仍可要求正常或优惠后的成本。

另外两张根据城市状态从 eligible pool 生成，例如：

- 特殊温室 / 市场 / 学院；
- 稀有人物；
- 150–200 coins 级资源包；
- 数回合建设折扣；
- 秘能生产阶段性 buff。

### 17.2 Eligibility

特殊卡必须根据城市成熟度过滤：

- 未建魔法部时，不给正式秘法官卡；
- 秘能规模过低时，不给明显中后期大型魔法项目；
- 唯一建筑已拥有后，不重复出现；
- 城市太小时，不出现与当前规模不匹配的项目。

---

## 18. Owl Daily / TurnFacts

系统先生成不可篡改的事实，Agent只能根据事实叙事。

TurnFacts 至少包含：

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
cardChoice
```

Agent 日报负责：

1. 告诉玩家实际发生了什么；
2. 解释自己的建设和派遣理由；
3. 告诉玩家下一回合准备做什么。

系统事实与 Agent 叙事必须严格分离。

---

## 19. 前 5 回合目标节奏

Turn 0–5 应形成一个明显的小镇，而不是仍处于教程状态。

目标体验：

- Agent 每个正常回合大约能建设 2–3 栋建筑，同时道路可以铺得更自由；
- 到 Turn 5，城市约形成 4 个小片区 / block 尺度的视觉结构；
- 不要求所有空间填满；
- 金币前期有一定压力，偶尔值得存一个回合；
- 人口有迁入滞后，但 3–5 回合能看到明显成熟；
- 秘能前期慢，建立 production / greenhouse 后开始明显增长；
- 第一批 Incident 可以出现，但频率不应淹没日报；
- Turn 5 第一次 Special Choice 标志城市从开荒进入第二阶段。

中后期金币应逐渐滚起来，不再长期成为普通扩张的主要瓶颈；主要约束逐步转向秘能、大型项目、空间设计与暴露治理。

---

## 20. 设计原则与非目标

### 20.1 保持轻量

MVP 不做：

- 电力 / 水 / 垃圾等传统城市模拟链；
- 复杂就业率 / 劳动力市场；
- 多种原材料库存；
- 秘法官完整 RPG 技能树；
- 居民逐户模拟；
- 依赖 block / district 的核心规则；
- 全城固定事故数量上限；
- 任意连续 magicRatio。

### 20.2 Agent 自由，但系统语义固定

Agent 可以自由设计建筑名字、风格和空间组合；但必须从系统固定玩法枚举中选择功能语义。

原则：

> 叙事语义自由，系统功能枚举固定。

### 20.3 优秀城市布局应有真实收益

庭院、广场、柱廊、普通用途、合理分散的公共设施，不只是美术建议，而应通过公共服务和 unified spatial exposure model 产生实际 gameplay 价值。

这样 Agent 自然有动力建设更好看、更像真实城市的空间。

---

## 21. 下一步

在增加新系统之前，优先完成：

1. 将当前代码中的建筑 metadata 迁移到五类功能格语义；
2. 实现离散 magicRatio 与按功能面积的成本 / 产出；
3. 实现人口与 5 格 public_service 覆盖；
4. 实现 unified building-level exposure；
5. 实现三类 Incident、独立 roll、historicalRisk；
6. 实现秘法官角色与招募 / assignment；
7. 重做卡牌生成：Turn 0 无卡、普通三选一、每 5 回合 Special Choice；
8. 将新城市 Agent 引导改为从 `old_town_entry` 建第一条道路；
9. 写一个轻量 simulation script，批量验证 5 / 10 / 20 回合经济、人口、秘能、事故数量与秘法官需求。

任何新增系统都应先证明它能强化上述核心循环，而不是仅增加内容数量。
