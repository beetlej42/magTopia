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
  floors: 3,
  expansionFloors: 1,
  roofVariant: 1,
  materialScheme: 1,
  nightLighting: 0.3
});

MagicTown.getVoxelBuildingContract();
```

三个预设分别验证日景、夜景和加层：

- `Voxel Terrace · Day`
- `Voxel Terrace · Night`
- `Voxel Terrace · Add Floor`

## 分辨率与空间合同

```text
1 voxel = 0.125 world unit
1 parcel width = 4 world units = 32 voxels
prototype depth = 4.5 world units = 36 voxels
1 floor module = 2.5 world units = 20 voxels
```

当前原型只生成可见表面，不填充不可见的实体内部。约一万级表面实例会按材质合并为不超过 14 个 `InstancedMesh` 批次；这用来快速验证建筑语法和画面，不是生产阶段的最终网格格式。

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

简单模式只要求：

```json
{
  "archetype": "terrace_magic_shop",
  "footprint": "1x2",
  "floors": 3,
  "style": "willow_magic",
  "quality": "simple"
}
```

服务端负责补全屋顶、立面开间、窗户节奏、烟囱、店面、统一材质和装饰槽。

高级模式可以覆盖：

- `roof.type`
- `facade.rhythm`
- 各组件材质
- 屋顶、店面和窗台装饰槽

单体素修改只作为确定性程序化生成后的稀疏 decoration patch。持久化的源数据仍然是 `BuildingSpec + seed + patches`，而不是整栋建筑的体素快照。

## 相邻连接

每栋建筑声明左右 party-wall port。紧邻建筑会：

- 建立确定性的 `party_wall` 连接；
- 省略双方不可见的共享外墙；
- 保留独立立面、屋顶、材质和产权语义；
- 为以后增加连廊、拱廊和内部功能合并留下端口。

“视觉贴合”不自动等于“功能合并”。

## 加层

`expansionFloors` 当前作用于街段中央建筑：

1. 保留原有地面层和标准楼层模块；
2. 追加一个或两个楼层模块；
3. 将 vertical-expansion port 移到新顶层；
4. 从新檐口重新生成原屋顶类型、烟囱和屋顶装饰。

这验证了扩建不需要修改每个体素，也不需要重新生产独立图片或 GLB。

## 当前边界

- 尚未把体素 `BuildingSpec` 写入服务端城市存档或建设命令。
- 当前使用材质级实例批次；尚未实现 chunk、greedy meshing 和顶点 AO。
- 后立面和内院仍是占位级语法。
- decoration 尚未提供单体素编辑 UI。
- 自动连接只实现 party wall；连廊、拱廊、共用屋面和内部打通仍未实现。
