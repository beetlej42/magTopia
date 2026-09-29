# 斜角巷 · 2×2 体素商业街（第二版）

三层魔杖店、带高阁楼的书店、低矮药剂店夹出一条 L 形内部巷道。入口朝 +Z，地块为 8×8 世界单位。临街面为闭合旧砖墙，仅通过细微砖缝暗示秘密入口，固定资产表现关闭状态，不含开墙动画。加长两侧房屋，取消原先的开放前庭；巷道先向里再右转。

第二版移除外露砖拱和临街橱窗；魔杖店增加悬挑房间、大老虎窗和更陡屋顶，书店增加高窄阁楼及铜色顶饰。低矮药剂店让俯视仍能看到部分内部店面。本版供继续审美迭代，不是整条电影街景的缩比复刻。

![正面](front.png)

![俯视](top.png)

![背面](back.png)

## 配色与实现

- 暖灰石墙、灰褐墙、旧红砖入口，共用蓝灰板岩屋顶和暖琥珀窗光，不使用米色 Tudor 木构。
- 新增 `shopGreen`、`shopWine` 哑光漆木材质，用于底层店面和吊牌；使用既有 painted 表面着色，非金属、非自发光。
- `src/generators/diagonAlley.js` 是固定资产源，复用 UrbanMassingSpec、VoxelInstanceBuffer 与 greedy meshing；所有面位于 0.125 体素网格。
- 7000 三角形；已有/新建 2×2 斜角巷、放置预览、CPU 可视化共用工厂。非 2×2 历史记录保留旧路径。
- 不改变卡牌遮蔽效果、成本或其他玩法。巷道为资产内部视觉空间，不写入城市道路网络。
- CPU 预览采用简化日光，不完整代表游戏内 AO、动态阴影和夜间发光。

## 再生成

```sh
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/front.png front 1024
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/top.png top 512
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/back.png back 512
```

测试覆盖四向边界、体素网格、面数预算、关闭入口墙的完整性、内巷两段及转角连续净空，以及城市/预览/可视化一致性。
