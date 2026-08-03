# UrbanMassingSpec v0.1

`UrbanMassingSpec` 是 MagicTown 通用体素体量的持久化源数据。它不声明教堂、商场或政府大楼等用途，而是声明 3×3 地块范围内的场地格、体量节点、形态操作、顶部和连接关系。

现有 `BuildingSpec v0.2` 保持有效，并自动派生为一个兼容的矩形 `solid` 体量。旧体素街道的立面、屋顶、装饰和稳定 seed 行为不变。

## 编译链

```text
3×3 内的边连接地块掩码
  + mass nodes
  + vertical profiles
  + standard voids
  + cap components
  + typed relations
  + materials and facade intent
  -> UrbanMassingSpec v0.1
  -> surface-only mass layers
  -> relation-aligned wall cuts
  -> cap surfaces
  -> mutually-exclusive sparse voxel field
  -> surface culling and material batches
```

## 场地合同

- 一个逻辑地块格固定为 `32 × 32` 个体素，对应 `4 × 4` 世界单位。
- 单个 `UrbanMassingSpec` 的包围范围最多为 `6 × 6` 格；常规公共建筑仍优先使用 `2 × 2` 到 `5 × 3`，只在大型校园或纪念性建筑确有需要时使用完整上限。
- 场地格必须通过边相连；只通过对角线相接无效。
- `footprint.cells` 是权威占地，不以包围矩形代替真实格子。
- 场地格的 `use` 支持：
  - `mass`：允许封闭、框架或开放体量；
  - `ground`：广场、台基、水池、花园等低矮场地；
  - `reserved`：属于组合但保持无建筑体量的空地。
- 大于 3×3 的建筑群由 Agent 在城市层组合多个规格；本规格不隐式扩张城市占地。

## 四类基础体量

| `type` | 围合方式 | 典型组合角色 |
| --- | --- | --- |
| `solid` | 完整墙体与顶部 | 主楼、侧翼、塔身、大厅 |
| `framed` | 梁柱框架与面板填充 | 温室、玻璃中庭、市场厅 |
| `open` | 柱、梁和顶部，无连续外墙 | 柱廊、门廊、亭子 |
| `ground` | 低矮场地表面 | 广场、台基、露台、水池基面 |

角色不是用途。`tower`、`church` 或 `government` 不作为底层体量类型。

`framed` 默认使用浅石灰色结构件和低饱和、半透明的 `lightGlass` 面板，以保证温室在主镜头下明亮可读。原有深色 `glass` 与铁框仍可由单个体量显式选择，供未来市场厅、工业建筑和车站使用。

框架节奏由独立参数控制：

```js
framing: {
  baySpacingVoxels: 8,
  frameWidthVoxels: 2,
  floorBeamSpacingVoxels: 8,
  reliefDepthVoxels: 1
}
```

墙面与 `glass_ridge` 共用同一开间节奏；`reliefDepthVoxels` 将主框架向面板外投影，使结构先于玻璃被读出。框架只向外露面投影，不会穿入相接的其他体量。

## 通用立面开口

`solid` 体量沿连续的北、东、南、西主平面自动划分开间，再按楼层布置门窗。开口继承普通房屋的表达方式：窗洞由石材窗套、加深窗台、窗楣、中心饰块和深色内窗扇分层组成；底层主入口带门框、双扇分缝、玻璃气窗、雨棚和托座。`facade.detailDensity` 用于压低或增强附加装饰，基础门窗节奏保持不变。

门窗只生成在足够长的连续平面上，并与平面端部保留退距。斜切和八角轮廓的转角折面不参与开间规划，因此不会为了连续环绕而把窗户硬塞到角上。

## 平面轮廓

- `rectangular`
- `chamfered`
- `octagonal`
- `semicircle`

体量首先由一个或多个逻辑格生成高分辨率平面掩码，再应用轮廓裁切。L、T、U 和十字形来自格子组合；斜切、八角和半圆端来自轮廓裁切。

单格体量不需要铺满整个 32×32 体素逻辑格。通过 `dimensionsVoxels: { width, depth }` 可以设置格内的实际平面尺寸；例如 20×20 的八角体量仍占用同一个 1×1 城市地块，但会形成明显更纤细的塔身，并在宿主屋顶周围留下退台。

需要相对底座直接退台或采用非中心构图时，使用：

```js
placement: {
  setbacksVoxels: {
    north: 6,
    east: 6,
    south: 6,
    west: 6
  },
  offsetVoxels: { x: 0, z: 0 }
}
```

四向退距分别裁切逻辑底座，随后应用偏移。`dimensionsVoxels` 适合直接指定尺寸；`placement.setbacksVoxels` 适合表达台基、塔楼退台和偏心侧翼。单格体量显式提供 `dimensionsVoxels` 时，以该尺寸为准，不再叠加四向退距，但仍会应用偏移。

## 垂直轮廓

- `uniform`：各高度保持同一平面；
- `stepped`：按固定高度产生离散退台；
- `tapered`：以更短步长持续收分；
- `stacked`：由显式高度与内缩带组成。

收分由平面掩码逐层腐蚀得到，始终保持体素表面和确定性结果。`stacked` 关系可以把一个独立体量放到另一个体量顶部；未显式声明子体量高度时，其基准高度由宿主体量顶部派生。编译器会沿子体量底部派生石材勒脚，并在宿主顶部生成一圈泛水/收边，避免塔身像直接穿过屋面。

## 顶部组件

- `flat`
- `parapet`
- `gable`
- `hip`
- `mansard`
- `glass_ridge`
- `glass_barrel`
- `sawtooth`
- `dome`
- `spire`

顶部独立于围合体量。`glass_ridge / glass_barrel` 使用框架与玻璃面板；`sawtooth` 通过受限的 `toothCount` 生成工业锯齿顶，并在陡直齿面使用窗材质形成连续采光；`dome` 和 `spire` 使用低多边形体素轮廓。顶部在结构体量之后写入；叠放子体量覆盖的宿主顶部区域会被省略。

所有坡面会补齐相邻高度列之间的竖向阶梯，因此陡峭尖顶和穹顶仍保持六面连通，不会在跳高处出现可见空缺。

## 标准负空间

- `courtyard`：贯穿体量的中央留空；
- `passage`：横穿体量的低层通道；
- `recess`：从指定立面向内的入口凹槽；
- `arch`：带圆拱上缘的定向开口。

v0.1 不提供任意体素布尔减法。Agent 选择语义明确的负空间，由编译器约束尺寸和方向。

## 体量关系

| `type` | 行为 |
| --- | --- |
| `separate` | 同一组合内保持独立 |
| `adjoin` | 删除完整共享接触面 |
| `portal` | 在共享接触面生成对齐门洞 |
| `stacked` | 将 `to` 体量叠放到 `from` 体量顶部 |

关系使用稳定体量 ID，不使用布尔 `connected`。`portal` 和 `adjoin` 只在双方实际共享逻辑格边时生成切口；无共享边的关系不会凭空生成连接体。

关系可以声明确定性的接口收口：

```js
{
  type: "portal",
  from: "main",
  to: "wing",
  widthVoxels: 7,
  heightVoxels: 13,
  finish: {
    trimWidthVoxels: 1,
    thresholdVoxels: 1
  }
}

{
  type: "stacked",
  from: "main",
  to: "tower",
  finish: {
    baseCourseHeightVoxels: 2,
    apronWidthVoxels: 1
  }
}
```

`portal` 在两侧洞口派生门槛、竖向衬边和过梁；`stacked` 派生子体量勒脚与宿主屋面收边。所有细节从关系 ID 和两端材质派生，不成为独立可漂移的装饰节点。

铁路不属于 v0.1。未来车站扩展应增加外部基础设施 port，而不改变本体量语法。

## 柱廊围合

`open` 体量可以逐面设置围合方式：

```js
enclosure: {
  sides: {
    north: "auto",
    east: "columns",
    south: "open",
    west: "wall"
  },
  columnSpacingVoxels: 7,
  columnWidthVoxels: 2,
  beamHeightVoxels: 2,
  plinthHeightVoxels: 0
}
```

- `auto`：外露时生成柱梁，实际接触其他非场地体量时自动取消该面的柱梁；
- `columns`：无论是否接触其他体量，都保留柱梁；
- `open`：整面不生成柱、梁或墙；
- `wall`：生成连续墙面。

柱列节奏沿当前立面自身计算，不再依赖全局 X/Z 坐标，因此不会有两面意外变成实墙。`adjoin` 和 `portal` 继续负责显式连接；`auto` 是柱廊用于清理实际接触面的局部规则。

## 场地细节

`ground` 体量可以在保持同一占地与高度的前提下声明场地处理：

```js
groundTreatment: {
  pattern: "garden",
  borderWidthVoxels: 1,
  pathWidthVoxels: 7,
  planterCount: 4
}
```

支持：

- `plain`：只有基础场地面；
- `bordered`：带中心通行缺口的低矮路缘；
- `courtyard`：路缘、十字铺装轴线和少量花池；
- `garden`：强化铺装轴线并生成更多确定性花池。

花池位置由 `seed + mass.id` 稳定派生，并始终检查自身 5×5 体素基座是否完全落在场地掩码内。

## 形态意图

体量不记录用途，但可以记录与几何表现直接相关的立面意图：

- `symmetry`
- `openness`
- `transparency`
- `entranceEmphasis`
- `floorHeightVoxels`
- `bayWidthVoxels`
- `entranceFace`
- `order`：`plain | classical | industrial | gothic`
- `baseCourseHeightVoxels`
- `stringCourseHeightVoxels`
- `corniceHeightVoxels`
- `cornerPierWidthVoxels`
- `pedimentHeightVoxels`
- `pedimentWidthVoxels`
- `rooflineOrnaments`

通用编译器用这些属性派生入口和基础窗列。较高的 `entranceEmphasis` 会同步增加门宽、入口台阶、雨棚出挑和成对门柱，而不再只改变门洞尺寸。`classical` order 会沿同一立面开间生成石质基座、层间线脚、檐口、转角壁柱和入口山花；`industrial` 使用更宽的结构开间、较少水平线脚和金属框架；`gothic` 使用窄高开间、尖拱窗冠、强化转角支撑并压低水平檐口。这些构件只派生装饰体素，不改变场地和体量占用。

## 稳定性与扩建

- `UrbanMassingSpec + seed` 是源数据，渲染体素始终派生。
- Studio 的 `Random` 使用 seed 确定性地改变高度、轮廓、垂直 profile、顶部、开窗和基础材质；相同 seed 必须得到相同组合。
- `mass.id`、`void.id` 和 `relation.id` 是稳定路径的一部分。
- 逐格扩建应保留已有体量 ID，只增加新场地格、体量或关系。
- 局部失败只重新规划失败节点，不重新随机整组建筑。
- 城市层负责多个 1×1～3×3 规格的组合、所有权、成本和道路连接。

## 当前边界

- 通用体量已经支持四向平面开间、分层窗套与入口构件，但尚未加入普通房屋的用途型模块，例如商铺橱窗、阳台和花箱。
- 不规则格子组合的坡顶使用统一体量顶部曲面，尚未求解多屋面交谷和泛水。
- `open` 体量使用规律柱梁网格，尚未提供拱柱、柱式和栏杆子语法。
- `ground` 已支持路缘、铺装轴线与确定性花池，但喷泉水盆、雕像和大型纪念物仍应作为后续场地附件。
- 内部房间、楼梯和精确室内导航不在 v0.1 范围。

## Studio 预设

在 Studio 选择 `Voxel Massing Grammar` 后，Massing Explorer 会提供四种可复现的生成范围：

- `Layout`：重新生成场地占用、体块节点和连接关系，保留光照参数。
- `Form`：保持场地与关系图，只探索体量高度、平面、屋顶和退台。
- `Detail`：保持体量拓扑，只探索立面、框架、开口和地面处理。
- `Everything`：从种子生成一套完整的新方案。

Explorer 同时提供 3×3 场地编辑、体块节点参数、关系图、JSON 往返编辑与实时校验。这样可以先用种子批量探索，再锁定拓扑并分别比较形体与细节，而不是只能在固定 preset 之间切换。

完整随机方案使用一套组合级材质与 facade order，而不是逐体块随机配色。`Massing · Civic Dome` 是首个概念图品质基准：中央大厅、对称翼楼、贴合主体的柱廊、鼓座穹顶与灯亭共享楼层线、开间和石作层级。

Preset 下拉仍可直接查看：

- `Massing · Minimum Capability Study`
- `Massing · Tower Courtyard`
- `Massing · White Greenhouse`
- `Massing · Civic Dome`

`Random` 现在生成完整的新组合；Preset 继续用于查看结构明确、便于比较的固定方案。
