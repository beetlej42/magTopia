# MagicTown 程序化体素建筑纵切

## 状态

本纵切是与现有 low-poly / Depth Relief / Hunyuan 建筑路径并行的实验渲染后端。它验证以下问题，不替换当前城市资产系统：

- 细体素能否保留魔法伦敦的砖石、板岩、窗套和屋顶细节；
- Agent 能否只提交少量选项，由服务端规格补全建筑；
- 相邻建筑能否自动形成连续街墙并省略共享外墙；
- 已有建筑能否通过追加楼层和重新生成屋顶完成扩建；
- 同一材质库能否支持昼夜变化和局部魔法发光。

概念目标见 [`concept-images/voxel-building-system-concept-001.png`](concept-images/voxel-building-system-concept-001.png)。

## 运行

启动前端后，在 `Mode` 中选择 `Procedural Voxel Street`，或在控制台调用：

```js
MagicTown.generateVoxelStreet({
  buildingCount: 3,
  floors: 2,
  floorPrograms: [
    { purpose: "shop" },
    { purpose: "home", setbackVoxels: 4, balcony: "full" }
  ],
  style: "violet_alchemist",
  parcelWidth: 36,
  parcelDepth: 40,
  ridgePosition: 0.35,
  windowRatio: 0.42,
  variation: 0.82,
  nightLighting: 0.3
});

MagicTown.getVoxelBuildingContract();
MagicTown.getVoxelGrammarCatalog();
MagicTown.createVoxelBuildingSpec({
  id: "agent-shop-1",
  seed: "agent-shop-seed",
  style: "violet_alchemist",
  widthVoxels: 36,
  depthVoxels: 40,
  baseFloors: 2,
  floorPrograms: [
    { purpose: "shop" },
    { purpose: "home", setbackVoxels: 4, balcony: "full" }
  ],
  ridgePosition: 0.35
});
```

除日景、夜景和加层预设外，生成实验室还提供三组语法预设：

- `Voxel Terrace · Day`
- `Voxel Terrace · Night`
- `Voxel Terrace · Add Floor`
- `Grammar · Townhouses`
- `Grammar · Magic Shops`
- `Grammar · Workshops`

`BuildingSpec v0.2` 的楼层栈、稳定子 seed 和连续坡屋顶规则见
[`VOXEL_BUILDING_SPEC_V0.2.md`](VOXEL_BUILDING_SPEC_V0.2.md)。

## 分辨率与空间合同

```text
1 voxel = 0.125 world unit
1 parcel width = 4 world units = 32 voxels
prototype depth = 4.5 world units = 36 voxels
1 floor module = 2.5 world units = 20 voxels
```

当前原型先将所有组件写入一个互斥稀疏体素场，再剔除六面都被遮挡的内部体素。约四万级可见表面实例会按材质合并为不超过 14 个 `InstancedMesh` 批次；这用来快速验证建筑语法和画面，不是生产阶段的最终网格格式。

同一个整数体素坐标只能存在一种材质。冲突先比较语义阶段优先级，同阶段才采用 `last write wins`：

```text
terrain
  -> structure
  -> roof
  -> opening
  -> trim
  -> decoration
  -> effect
```

因此组件之间不会生成两张共面的材质面，也不会因深度精度产生闪烁。

生产目标是：

```text
BuildingSpec + seed
  -> component grammar
  -> sparse/chunked voxel field
  -> greedy surface mesh
  -> material palette + vertex AO
  -> runtime decoration voxel patches
```

## Agent 控制层级

简单模式可以直接提交楼层栈：

```json
{
  "floorPrograms": [
    { "purpose": "shop" },
    { "purpose": "home", "setbackVoxels": 2, "balcony": "full" }
  ],
  "style": "violet_alchemist",
  "ridgePosition": 0.5,
  "windowRatio": 0.4
}
```

服务端负责补全屋顶、立面开间、窗户节奏、烟囱、店面、统一材质和装饰槽。

高级模式可以覆盖：

- `roof.type`
- `facade.rhythm`
- 各组件材质
- 屋顶、店面和窗台装饰槽

单体素修改只作为确定性程序化生成后的稀疏 decoration patch。持久化的源数据仍然是 `BuildingSpec + seed + patches`，而不是整栋建筑的体素快照。

## v0.2 建筑语法

当前 `BuildingSpec` 编译器已实现：

- `shop`、`home`、`workshop`、`storage` 四种原子楼层用途；
- `london_brick`、`violet_alchemist`、`forest_craft` 三套 Style Kit；
- 一至五层基础楼层，每层独立用途、前向退台和阳台形式；
- 根据 24–40 体素地块宽度自适应的 2–5 开间立面；
- 真正改变窗洞宽度和高度的 15%–90% 窗墙比；
- 每栋建筑、每个楼层和每个装饰槽的路径化稳定子 seed；
- 任意 seed 的确定性重放，以及加层时低层分格与材料保持不变。

## 相邻连接

每栋建筑声明左右 party-wall port。紧邻建筑会：

- 建立确定性的 `party_wall` 连接；
- 省略双方不可见的共享外墙；
- 比较双方逐列屋顶包络，只补出高低建筑之间真正暴露的共墙；
- 保留独立立面、屋顶、材质和产权语义；
- 为以后增加连廊、拱廊和内部功能合并留下端口。

“视觉贴合”不自动等于“功能合并”。

## 加层

`expansionFloors` 当前作用于街段中央建筑：

1. 保留原有地面层和标准楼层模块；
2. 追加一个或两个楼层模块；
3. 将 vertical-expansion port 移到新顶层；
4. 从新檐口重新生成连续坡屋顶、烟囱和屋顶装饰。

测试还会逐项比较扩建前后的低层 `facade.floors`、材料和稳定装饰槽，避免随机数调用顺序导致整栋建筑“换脸”。

这验证了扩建不需要修改每个体素，也不需要重新生产独立图片或 GLB。

## 程序化坡屋顶

坡屋顶统一使用连续线性剖面。生成器接收：

- 建筑宽度与深度
- 屋脊高度和 0–100% 相对位置
- 出檐和屋面厚度

屋脊始终平行联排街道，生成器为每个深度切片生成完整屋面行。50% 是对称双坡顶，偏离中心得到不对称双坡，0% 和 100% 分别退化为两个方向的单坡顶。左右山墙和前后高檐封墙都会自动补齐；相邻建筑暴露部分仍由双方屋顶包络决定。

## 当前边界

- 尚未把体素 `BuildingSpec` 写入服务端城市存档或建设命令。
- 当前使用互斥稀疏体素场和材质级实例批次；尚未实现 chunk、greedy meshing 和顶点 AO。
- 主体支持沿临街深度方向逐层退台；左右收分、侧翼、塔楼和 L 形屋顶交谷尚未实现。
- 后立面和内院仍是占位级语法。
- decoration 尚未提供单体素编辑 UI。
- 自动连接只实现 party wall；连廊、拱廊、共用屋面和内部打通仍未实现。
