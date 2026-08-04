# BuildingSpec v0.2

`BuildingSpec` 是程序化体素建筑的持久化源数据。v0.2 将整栋 Archetype 进一步拆成可逐层堆叠的 `floorPrograms`；体素、网格、碰撞和灯光均由规格派生。

## 编译链

```text
地块 + 邻接边 + floorPrograms + corner facades + style kit + seed
  -> BuildingSpec v0.2
  -> floor stack
  -> facade-bays-v0.1
  -> voxel-roof-heightfield-v0.3
  -> 稳定装饰槽
  -> 带语义优先级的互斥体素场
  -> 表面剔除与材质批次
```

## 原子楼层

每层可以独立声明：

```js
{
  purpose: "home",
  setbackVoxels: 2,
  balcony: "full",
  windowRatio: 0.35
}
```

支持的 `purpose`：

- `shop`
- `home`
- `workshop`
- `storage`

支持的 `balcony`：

- `none`
- `selective`：一个确定性开间
- `full`：全宽阳台

`setbackVoxels` 表示相对下一层继续后退的深度。生成器累计退台距离，移动该层立面和侧墙，并在楼层交界生成露台面。第一层退台固定为 0。

建筑可以只有一层。扩建时，如果没有显式提供新楼层规格，会继承最高已有楼层的用途，但不会重复已有退台或阳台。

## 示例

```js
{
  specVersion: "0.2",
  id: "voxel-building-2",
  seed: "shop-house-001",
  style: "violet_alchemist",
  footprint: {
    widthVoxels: 36,
    depthVoxels: 40
  },
  baseFloors: 2,
  floorSpecs: [
    {
      index: 0,
      purpose: "shop",
      setbackVoxels: 0,
      frontSetbackVoxels: 0,
      balcony: "none",
      windowRatio: 0.86
    },
    {
      index: 1,
      purpose: "home",
      setbackVoxels: 4,
      frontSetbackVoxels: 4,
      balcony: "full",
      windowRatio: 0.32
    }
  ],
  facade: {
    grammar: "facade-bays-v0.1",
    rhythm: "4-bay",
    floors: []
  },
  sideFacades: {
    right: {
      grammar: "facade-bays-v0.1",
      rhythm: "4-bay",
      floors: []
    }
  },
  roof: {
    grammar: "voxel-roof-heightfield-v0.3",
    type: "pitched",
    form: "gable_street",
    ridgeRatio: 0.35,
    ridgeHeight: 14,
    overhang: 1,
    thickness: 1,
    chimneys: []
  },
  materials: {},
  decorations: {},
  adjacency: {},
  ports: {}
}
```

## 窗墙比

`floorPrograms[].windowRatio` 的范围是 `0.15–0.9`，并且逐层独立。它同时
控制该层窗洞的宽度和高度，而不是只改变窗户数量。因此一层商铺可以使用
`0.86` 的通高大橱窗，二层住宅同时使用 `0.32` 的较小窗户；门仍保留可用的
最小尺寸。正立面与街角侧立面读取同一份楼层参数，所以转角两面会保持一致。

顶层 `windowRatio` 只作为旧 API 和未显式填写楼层的默认值保留。生成实验室
不再提供整栋滑杆，而是为每层显示独立的 `Window Share`。

立面先保留左右结构边，再把可用宽度分配给 2–5 个 bay。楼层用途决定每个 bay 使用普通窗、商店窗、工坊窗、小储藏窗或入口。

## 街角侧立面

侧立面不是墙面装饰贴片，而是与正立面同级的程序化立面。街段接口使用
`cornerFacades: "none" | "left" | "right" | "both"`；单栋
`BuildingSpec` 接口使用 `sideFacadeSides: ["left", "right"]`。

只有没有相邻建筑的暴露侧面会接受侧立面。每个侧面使用独立、稳定的路径化
seed 和沿建筑深度分配的开间，但继承同一组 `floorSpecs`：

- `shop` 层生成侧向商店橱窗和可选侧门；
- `home` 层生成住宅窗、花箱和阳台；
- `workshop` 与 `storage` 保持各自的门窗尺度；
- 前向退台会同步缩短该层侧立面，不会在已经退掉的区域生成悬空窗口。

因此街角建筑可以让商铺沿相邻两面连续展开，同时联排内部 party wall 仍保持
完全封闭。加层只追加新的侧立面楼层，已有低层开间不因随机数顺序而改变。

## 二维连续坡屋顶

屋顶由统一的二维整数高度场生成，支持三种 `roof.form`：

- `gable_street`：屋脊平行街道，坡度沿建筑深度变化；
- `gable_cross`：屋脊垂直街道，坡度沿建筑宽度变化；
- `hip`：四边同时向中心升高，矩形建筑会自然形成一段居中的短屋脊。

两种双坡顶的 `ridgePosition` 接受 `0–1`：

- `0.5`：标准对称双坡顶；
- `0.25` 或 `0.75`：不对称双坡顶；
- `0` 或 `1`：屋脊退到对应边缘，退化为单坡顶。

每个平面坐标都有确定的屋面高度。相邻坐标一次跨越多个体素高度时，
求解器会补齐两者之间的竖向阶梯面，因此 7%、93% 等陡坡仍保持六面连通。
山墙、四周封檐、屋脊、烟囱和天窗都从同一高度场派生；相邻建筑的暴露共墙
也直接比较双方边界高度，不再依赖某一个固定方向的一维剖面。

## 稳定子 seed 与扩建

每栋建筑、每个楼层和每种组件使用路径化子 seed：

```text
street-seed:voxel-building-2:facade:floor:1
street-seed:voxel-building-2:roof
street-seed:voxel-building-2:decorations:magic-window:1:2
```

扩建必须保持已有 `floorSpecs`、立面分格、材料和低层装饰槽完全不变，只生成新楼层并重新抬升屋顶与相邻共墙包络。

## 体素写入阶段

```text
terrain 0
structure 10
roof 20
opening 30
trim 40
decoration 50
effect 60
```

高阶段覆盖低阶段；低阶段不能破坏高阶段体素；同阶段使用后写覆盖。

## 当前边界

- 退台目前只沿临街深度方向，尚未支持左右收分或独立侧翼。
- `BuildingSpec` 主体仍是矩形 floor stack；塔楼、L 形体块和多体量组合由上层 `UrbanMassingSpec v0.1` 表达。
- 后立面和内院尚未使用 bay grammar。
- BuildingSpec 尚未写入服务端城市存档。
- 生产网格目标仍是 chunked greedy mesh。

每个 `BuildingSpec v0.2` 会自动附带一个派生的兼容 `solid` 体量。这不改变旧渲染路径，只让现有住宅/店铺语法可以作为通用体量系统中的单节点继续组合。
