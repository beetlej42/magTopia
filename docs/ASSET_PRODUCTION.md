# Magic London 正式基础资产包

`public/generated/magic-london-starter-001/asset-registry.json` 是第一批正式资产的可调用索引：3 栋受同一 `1x1`、`4×4×4` 世界单位基准板约束的初始建筑。每项均有 RGB、透明 mask、对齐 emissive、Depth Anything 相对深度与法线图，以及独立 `asset.json`。

## Agent 调用边界

Agent 只按 `archetype`、`footprint`、标签与夜间意图请求资产；系统从 registry 选择现有 `assetId`。Agent 不传图像路径，也不直接修改 prompt。

```js
const candidates = MAGTOPIA.findAssetCandidates({
  footprint: "1x1",
  tags: ["starter"]
});
```

## 图集生产命令

```bash
node scripts/python-runtime.mjs scripts/slice_asset_sheet.py --input <sheet.png> --out-dir public/generated/<pack> --guide public/generated/<pack>/guide-4x4x4.json --columns <n> --rows <n> --assets '<json>'
node scripts/python-runtime.mjs scripts/run_depth_anything_batch.py public/generated/<pack>/*/rgb.png --linear-guide-fit
```

`--guide` 会把统一的三点底座 UV 契约写入每个 `asset.json`。新资产应直接继承该契约；只有早期图像模型改动过底座轮廓的资产才允许记录一次性的离线校准锚点。

本资产包已经使用本机缓存的 Depth Anything V2 Small 生成相对深度。`--linear-guide-fit` 会同时保存未归一化的 Float32 模型输出、程序化 guide 可见面的理论 view-space 深度，并按 2%–98% quantile 拟合唯一的全局线性关系 `viewDepth = slope × rawDepth + intercept`。拟合后的 Float32 深度是正式数值；PNG 只是在完整拟合范围内的 8-bit 运行时编码，不再叠加逐像素或分区 residual。

模型快照存在时，可将 `--model` 指向 Hugging Face cache 中的 `snapshots/<revision>` 目录，避免触发网络查询。每项资产会写出：

- `depth-anything-raw.npy`：Depth Anything 原始 Float32 相对深度；
- `depth-guide.npy`：程序化底图可见面的理论 Float32 view depth；
- `depth-anything-linear.npy`：全局线性映射后的 Float32 世界深度；
- `depth-anything-linear.png`：供浏览器使用的完整拟合范围编码；
- `depth-anything.json`：斜率、截距、quantile RMSE、`R²`、编码范围和底座方向诊断。
