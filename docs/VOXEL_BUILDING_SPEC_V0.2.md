# BuildingSpec v0.2

`BuildingSpec` 是程序化体素建筑的持久化源数据。v0.2 将整栋 Archetype 进一步拆成可逐层堆叠的 `floorPrograms`；体素、网格、碰撞和灯光均由规格派生。

## 编译链

```text
地块 + 邻接边 + floorPrograms + style kit + seed
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
      windowRatio: 0.42
    },
    {
      index: 1,
      purpose: "home",
      setbackVoxels: 4,
      frontSetbackVoxels: 4,
      balcony: "full",
      windowRatio: 0.42
    }
  ],
  facade: {
    grammar: "facade-bays-v0.1",
    rhythm: "4-bay",
    floors: []
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

`windowRatio` 的范围是 `0.15–0.9`。它同时控制窗洞宽度和高度，而不是只改变窗户数量。因此 20% 会生成真正更窄、更矮的窗户；门仍保留可用的最小尺寸。

立面先保留左右结构边，再把可用宽度分配给 2–5 个 bay。楼层用途决定每个 bay 使用普通窗、商店窗、工坊窗、小储藏窗或入口。

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
- 主体仍是矩形 floor stack；塔楼、L 形体块和屋面交谷留给后续版本。
- 后立面和内院尚未使用 bay grammar。
- BuildingSpec 尚未写入服务端城市存档。
- 生产网格目标仍是 chunked greedy mesh。
