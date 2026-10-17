# 皇家植物温室 · Royal Botanical Greenhouse

固定资产 `royal-greenhouse-001`，2×2 逻辑格（8×8 世界单位），门朝 +Z。使用现有 0.125 体素网格、共享公共建筑材质、表面剔除和 greedy meshing，与魔法部、斜角巷一致。

中央八角玻璃亭搭配两侧较低的弧顶花房，顶部为小型皇冠通风亭。深绿骨架、暖石材基座和淡青玻璃围绕月冠树；前方保留步道、两组花坛和低栏杆。细节包括攀门藤蔓、植物徽章、室内陶盆、盆栽台、园丁账簿与工具，以及后侧维护门、雨水桶和备用花盆。

月冠树使用弯曲树干、六组独立体素叶片与三朵浅色花。叶片缓慢摆动，每帧仅改变刚体姿态；夜间仅花朵和花心增加自发光，没有额外点光源。静态预览使用零时刻姿态。

## 玻璃与性能

玻璃复用 `lightGlass`，只在本资产实例中把透明度调至 0.24，并关闭深度写入与投影，保持植物可读性。CPU 轻渲染器保留最近一层透明表面；WebGL 会显示更多玻璃层，两者透明效果存在正常差异。中央穹顶采用连续的体素高度场，肋条与玻璃顶面匹配，避免台阶盖住框架。

约 1.16 万三角形，19 次绘制，零贴图、零额外点光源；活动叶片与花朵按部件合并同材质分块。所有建筑、装饰和动画均限制在 2×2 地块内。

## 再生成

```sh
pnpm visualize:building public/generated/royal-greenhouse-001/asset.json artifacts/royal-greenhouse-front.png front 1024
pnpm visualize:building public/generated/royal-greenhouse-001/asset.json artifacts/royal-greenhouse-back.png back 1024
pnpm visualize:building public/generated/royal-greenhouse-001/asset.json artifacts/royal-greenhouse-top.png top 1024
```

## 接入

- `src/generators/royalGreenhouse.js` 为权威模型源。
- 统一模型工厂、CLI 轻渲染、卡牌放置预览与城市使用同一资产。
- 已有和新建的 2×2 皇家温室按特殊卡身份采用该外观；历史其他尺寸继续走原路径。
- 建设期间继续显示施工围场，下回合完成后显示温室。
- 保留唯一建筑、免费放置、城市至少四栋建筑解锁、每回合 12 奥术能量等既有规则。
- 皇家温室标记为已完成资产；后续奥术温室仍保持独立占位状态。

验证覆盖四向与缩放边界、体素网格、透明材质、共享模型、旧城加载、施工状态、球面投影、昼夜自发光、动画不重建几何，以及确定性三视图。
