# BuildingDesign API v1

`BuildingDesign` 统一 MagicTown 的两种程序化体素建筑生成模式：

- `floor_stack`：逐层住宅、商铺、工坊和联排单体，源规格为 `BuildingSpec v0.2`；
- `urban_massing`：大厅、塔楼、庭院、校园和多体量公共建筑，源规格为 `UrbanMassingSpec v0.1`。

统一的是意图、版本、装饰、确认、施工和升级生命周期。两种模式保留各自的源规格与编译器，并共同输出可渲染的体素几何。

## 生命周期

```text
editable design revision
  -> confirmed revision + immutable spec hash
  -> idempotent construction order
  -> built design attached to the building
  -> upgrade design derived from the built revision
```

设计 revision 不修改城市版本；确认后的施工或升级才在城市事务中检查并推进 `city_version`。

## 1. 创建推荐设计

```http
POST /api/v1/cities/{city_id}/building-designs
```

```json
{
  "generation_mode": "auto",
  "site": { "lot_id": "cell-20-20", "footprint": "1x1", "entrance": "south" },
  "intent": {
    "name": "月柳药剂铺",
    "purpose": "一层经营药剂，楼上居住",
    "composition": "street",
    "frontage": "display",
    "access": "public",
    "style": "victorian_gothic",
    "prominence": "ordinary",
    "magic_level": 0.55
  },
  "requirements": { "preferred_floors": 1 }
}
```

`auto` 会将普通 1×1 街屋推荐为 `floor_stack`；多格占地、institutional frontage、landmark，或 `court / hall / tower / yard` composition 会推荐为 `urban_massing`。

响应包含生成模式、完整 `sourceSpec`、独立 `DecorationSpec`、稳定的 `primary_entrance` port、revision、`specHash`、设计锁，以及共同和模式专属的 `availableOperations`。`availableOperations` 同时列出合法 decoration type 和 anchor pattern；未知枚举会明确报错，不会静默替换 Agent 输入。第一版 `floor_stack` 限定为 1×1 逻辑地块；更大的建筑使用 `urban_massing`，避免逐层原型静默越出地块。

## 2. 创建设计 revision

```http
POST /api/v1/cities/{city_id}/building-designs/{design_id}/revisions
```

```json
{
  "expected_revision": 1,
  "operations": [
    { "op": "add_floor", "count": 1 },
    { "op": "set_floor_program", "floor_index": 0, "purpose": "shop", "window_ratio": 0.82 },
    {
      "op": "add_decoration",
      "decoration": {
        "id": "shop-sign",
        "type": "hanging_sign",
        "anchor": "main/floor-0/facade-south/bay-1",
        "parameters": { "material": "aged_timber" }
      }
    }
  ]
}
```

共同操作：`set_intent`、`set_roof`、`set_material`、`add_decoration`、`update_decoration`、`remove_decoration`。

### 4×4 语义纹章店招

`semantic_grid_sign` 为 Agent 提供无需预制模型的沿街店招。图案固定为四行四列，使用 `0/1` 或 `./#` 表示暗格与亮格。4×4 是逻辑网格，不继承建筑的 12.5cm 体素：每个亮格固定为建筑体素的一半，即 6.25cm，Agent 不可修改。招牌默认垂直墙面侧挂并双面显示；使用 `entrance` anchor 时，编译器会把安装点移动到入口侧柱，并让牌面底部高于门楣一个建筑体素。侧挂牌最靠墙的边缘也会与立面保持一个建筑体素的净距，支架长度由牌面尺寸自动派生，从而避免透视下与门楣叠在一起。边框、底板和发光色只能从现有 MagicTown 材质目录选择：

```json
{
  "op": "add_decoration",
  "decoration": {
    "id": "potion-sign",
    "type": "semantic_grid_sign",
    "anchor": "main/floor-0/facade-south/entrance",
    "parameters": {
      "grid": [".##.", ".##.", "#..#", "####"],
      "frameMaterial": "patinaMetal",
      "boardMaterial": "slate",
      "emissiveMaterial": "tealMagic",
      "frameStyle": "crowned",
      "mount": "projecting"
    }
  }
}
```

合法材质、边框样式、安装方式、固定微体素比例和 anchor pattern 随设计响应的 `availableOperations.semanticGridSign` 返回，Agent 不需要硬编码目录。发光材质限定为 `tealMagic / violetMagic / warmWindow`，保持项目的炼金青绿、奥术紫与暖金语义。

当设计被识别为沿街商铺（`frontage: "display"` 或首层程序为 `shop`）且还没有 `semantic_grid_sign` 时，设计响应会包含非阻塞的 `agentGuidance`：

```json
{
  "code": "custom_shop_sign_recommended",
  "phase": "design_before_construction",
  "severity": "recommendation",
  "blocking": false,
  "message": "Add a custom semantic_grid_sign before construction so the shop's street-facing function is recognizable.",
  "suggestedAction": {
    "operation": "add_decoration",
    "decorationType": "semantic_grid_sign",
    "anchor": "main/floor-0/facade-south/entrance",
    "agentChooses": ["grid", "frameMaterial", "boardMaterial", "emissiveMaterial", "frameStyle"]
  }
}
```

Agent 添加自定义店招后，该提示自动消失。它不阻止确认，施工请求的 `agent_guidance` 也会再次携带同一检查结果，供上层 Agent 在正式提交前做最后检查。

`floor_stack` 支持 `add_floor`、`set_floor_program`；`urban_massing` 支持 `add_floor`、`add_mass`、`update_mass`、`remove_mass`。

服务端会重新归一化源规格，并校验 mass 关系、占地、高度和 decoration anchor。`layout / form / detail / roof / materials / decorations / floors` 等锁会阻止对应操作。

## 3. 确认设计

```http
POST /api/v1/cities/{city_id}/building-designs/{design_id}/confirm
```

```json
{ "expected_revision": 3 }
```

确认前服务端会在 headless 环境实际运行对应的体素编译器。编译异常、空几何或零 mesh 会阻止确认；成功响应包含 `compileDiagnostics`（生成模式、renderer、occupied voxel、mesh/vertex/triangle 数量、decoration 数量、入口 port 与坐标变换）。因此 Agent 不需要截图就能确认 source spec 可生成。

确认后设计不可继续修改。`specHash` 只覆盖权威设计内容，不因 editable/confirmed 状态与编译诊断切换而变化。

## 4. 施工

```http
POST /api/v1/cities/{city_id}/construction-previews
POST /api/v1/cities/{city_id}/construction-orders
```

```json
{
  "expected_city_version": 27,
  "design_id": "design_123",
  "design_revision": 3,
  "design_hash": "sha256...",
  "actor_note": "建设已确认的月柳药剂铺"
}
```

施工订单必须带 `Idempotency-Key`。服务端从数据库读取确认版本，不接受客户端上传的 `voxel` source spec，并在城市事务内再次锁定设计状态、revision 和目标城市。

建成的城市建筑保存权威 `voxelDesign`、design revision、生成模式、seed、source spec 和 decorations。渲染体素是可重新编译的产物，不是存档真相。

矩形 `urban_massing` 使用东西入口时，source spec 会先交换 width/depth，再由 viewer 做 90° 坐标变换，保证旋转后的结构仍对应原逻辑 footprint。语义 preset 若不能适配合法的小地块，推荐器会产生带 `recommendationFallback` 元数据的 parcel-fitted 体量，并在确认阶段重新编译验证。

## 5. 升级

```http
POST /api/v1/cities/{city_id}/buildings/{building_id}/upgrade-designs
```

```json
{ "goal": { "type": "add_floor", "count": 1 } }
```

升级返回新的 editable design，之后仍经过 revision、confirm、preview 和 construction order。第一版升级保持原 footprint：

- `floor_stack` 追加稳定楼层并重建屋顶；
- `urban_massing` 增高 primary mass；
- 原建筑 ID 不变，旧设计写入 `designHistory`；
- 建筑在升级设计创建后被其他升级改变时，施工以 `BUILDING_DESIGN_BASE_CONFLICT` 拒绝。

新增占地、侧翼和跨建筑关系将在后续版本加入三维 reservation 后开放。

## 渲染

城市 viewer 会识别建筑上的 `voxelDesign`：`floor_stack` 使用精确 `BuildingSpec`，`urban_massing` 使用精确 `UrbanMassingSpec`；共同 `DecorationSpec` 在稳定 facade、roof 或 mass anchor 上派生运行时装饰。加层后仍存在的 anchor 会继续使用同一个 decoration ID。
