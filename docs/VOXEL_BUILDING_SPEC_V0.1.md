# BuildingSpec v0.1

`BuildingSpec` 是程序化体素建筑的持久化源数据。渲染体素、网格、碰撞和灯光均由它派生，不作为需要逐格保存的建筑本体。

## 编译链

```text
地块 + 邻接边 + archetype + style kit + seed
  -> BuildingSpec v0.1
  -> 楼层与体块
  -> facade-bays-v0.1
  -> pitched-roof-v0.1
  -> 稳定装饰槽
  -> 带语义优先级的互斥体素场
  -> 表面剔除与材质批次
```

每栋建筑、每个楼层和每种组件都使用路径化子 seed，例如：

```text
street-seed:voxel-building-2:facade:floor:1
street-seed:voxel-building-2:roof
street-seed:voxel-building-2:decorations:magic-window:1:2
```

加层只会增加新的楼层路径。已经存在的楼层分格、入口、材料、屋顶类型和低层装饰槽不会因为随机数消费顺序变化而重排。

## v0.1 字段

```js
{
  specVersion: "0.1",
  id: "voxel-building-2",
  seed: "grammar-magic-shops-001",
  archetype: "magic_shop",
  style: "violet_alchemist",
  variation: 0.82,

  origin: { x: -18, y: 0, z: -20 },
  footprint: {
    widthVoxels: 36,
    depthVoxels: 40,
    worldWidth: 4.5,
    worldDepth: 5
  },

  baseFloors: 3,
  floors: 3,
  expandedBy: 0,
  floorHeight: 20,
  floorSpecs: [],

  facade: {
    grammar: "facade-bays-v0.1",
    rhythm: "4-bay",
    entranceBay: 1,
    symmetry: 0.71,
    bays: [],
    floors: []
  },

  roof: {
    grammar: "pitched-roof-v0.1",
    type: "magic_asymmetric",
    ridgeRatio: 0.57,
    ridgeHeight: 16,
    overhang: 1,
    thickness: 1,
    chimneys: []
  },

  materials: {},
  decorations: {
    density: 1,
    greenery: 0.55,
    magicWindow: { floor: 1, bay: 2 },
    roofDecoration: null,
    stableSlots: []
  },

  adjacency: {},
  ports: {}
}
```

## Archetype

v0.1 提供三种用途语法：

| ID | 底层 | 上层 | 主要变化 |
| --- | --- | --- | --- |
| `townhouse` | 住宅入口与普通窗 | 住宅窗、花箱、少量阳台 | 2–4 开间，较规整 |
| `magic_shop` | 店门与连续橱窗 | 住宅窗与魔法展示窗 | 3–5 开间，允许非对称魔法屋顶 |
| `workshop` | 侧置工作门与宽窗 | atelier 窗 | 较粗犷，烟囱更多 |

Archetype 决定“可以出现什么”，不直接决定颜色和体素材质。

## Style Kit

v0.1 提供：

- `london_brick`
- `violet_alchemist`
- `forest_craft`

Style Kit 约束墙体与窗套材质、屋顶类型集合、推荐坡度、绿化倍率和魔法强度。一个 Style Kit 内仍允许少量确定性的墙色与窗套变化，但不会跨出该风格的材质集合。

## 立面分格

立面先保留左右各 2 个结构体素，再将可用宽度无缝分配给 2–5 个 bay。每个楼层在同一 bay 网格上选择语义组件：

- `entrance`
- `service_door`
- `window`
- `shop_window`
- `workshop_window`
- `upper_window`
- `blank`

组件只声明开洞范围和附属规则。渲染层负责根据实际 bay 宽度生成窗框、竖梃、阳台和花箱，因此不依赖固定尺寸模型。

## 体素写入优先级

同一整数坐标只能存在一个体素。写入顺序之外还有明确阶段：

```text
terrain 0
structure 10
roof 20
opening 30
trim 40
decoration 50
effect 60
```

高阶段可以覆盖低阶段；低阶段不能破坏已经存在的高阶段体素；同阶段冲突采用后写覆盖。这保证门窗不会被结构补墙封住，也保留 decoration 最终修饰普通组件的能力。

## 扩建不变量

垂直扩建必须满足：

1. 原有 `floorSpecs` 和 `facade.floors` 完全不变；
2. 原有材料选择不变；
3. 屋顶类型和烟囱布局不变，只抬升屋顶基准面；
4. 已选中的低层装饰槽不变；
5. 只重新计算新增楼层、屋顶高度和与邻居之间暴露的共墙包络。

## 当前边界

- v0.1 的主体体块仍是单矩形，侧翼、退台和塔楼留给 v0.2。
- 屋顶求解器支持矩形 footprint；L 形 footprint 的屋面并集和交谷尚未实现。
- 后立面和内院尚未使用 bay grammar。
- BuildingSpec 尚未写入服务端城市存档。
- 网格仍使用材质级实例体素，生产目标是 chunked greedy mesh。
