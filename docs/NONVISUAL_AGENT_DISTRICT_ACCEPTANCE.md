# 无视觉 Agent 街区建造验收

这套验收用于证明 Agent 只依赖结构化 API，就能在空白体素世界中完成选址、建筑设计、装饰、施工、跨水道路、街区组合和升级。它不启动相机，不读取截图，也不调用视觉模型。

运行：

```bash
pnpm test:agent-build
```

核心实现位于：

- `src/city/voxel-world.js`：Agent Intent District 同源的 50×50 空白地形合同；
- `src/city/agent-district-simulation.js`：确定性的市政 Agent 动作与结构化验收；
- `test/agentDistrictSimulation.test.js`：世界、水/桥和三街区回归。

## 世界合同

- 2500 个逻辑格全部显式存在，包括水和 shore；
- 每格 32×32 体素、4×4 世界单位，坐标约定为 `row - 1 = north = world +Z`；
- 自然高程 0–4 体素，水面 -3；
- 水格 `buildable=false / bridgeRequired=true`，shore `strictBuildable=false`；
- 初始 buildings、roads、bridges 和 reservations 均为空，只保留可路由的 `old_town_entry` 外部节点。

## 固定验收场景

场景创建三个街区、八栋建筑：

| 街区 | 数量 | 主要类型 |
|---|---:|---|
| Lantern Row | 3 | 多层住宅、商铺、药剂铺 |
| Market Court | 3 | 3×2 市场、2×2 庭院、2×2 工坊 |
| West Bank | 2 | 河西住宅、3×2 学院 |

覆盖 `floor_stack` 与 `urban_massing`，1×1、2×2、3×2 三种 footprint，四种合法风格，每栋至少一个 decoration。第一栋随后从两层升级为三层，building ID、footprint 和入口保持不变。

每个 confirmed design 都必须满足：

```text
compileDiagnostics.status == compiled
compileDiagnostics.occupiedVoxels > 0
compileDiagnostics.meshCount > 0
decorationCount >= 1
```

路网验收从 `old_town_entry` 对 road/bridge cells 做 BFS，并要求每栋建筑的精确入口 port 都在同一可达分量内。道路不得穿过 building footprint 或 reservation；显式水格只能作为 bridge，已有桥再次使用时增量桥成本为零。

## 2026-08-02 独立子 Agent 复测

独立建造 Agent 对默认 seed 的结果：

```text
success=true, failures=[]
districts=3, buildings=8
floor_stack=4, urban_massing=4
roads=57, bridges=3, reachable network cells=60
all structural checks=true
```

八栋建筑的 occupied voxel 数为：

```text
9099, 12237, 6285, 50888, 43413, 32512, 9083, 69422
```

替代 seed 同样通过，另抽样八个 seed 也全部成功；道路数为 58–65，桥梁数为 2–3。升级后的第一栋建筑保持 ID 和占地不变，2→3 层并记录旧 design revision。

## 已修复的失败

- 服务曾删除水格并把任意缺失坐标当桥；现在水格显式存在，越界不可走。
- `canOccupyFootprint` 曾忽略 buildable；现在 water/shore 均不可作为建筑 parcel。
- A* 曾穿过 reservation；现在选入口和路由都拒绝 reservation。
- 已有桥曾重复收费；现在只计算新增 bridge cells。
- site search 曾忽略 bounds、near id、prefer 和 avoid；现在这些输入参与筛选或评分，并返回真实 score explanation 与 terrain summary。
- `2x2 hall + large_bay` 推荐曾产生越界 mass；现在合法 parcel 总能得到可编译的 parcel-fitted fallback。
- 非正方形 massing 的东西入口曾在 viewer 旋转后越界；现在 source dimension 与坐标变换一致。
- 道路曾在宽立面任意选角落；现在设计保存稳定的 primary entrance frontage cell。
- 订单成功曾不代表体素可生成；现在 confirm 阶段执行 headless compile 并返回机器可读诊断。
