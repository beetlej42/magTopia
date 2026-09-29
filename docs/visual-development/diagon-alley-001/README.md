# 斜角巷 · 2×2 体素商业街（第三版）

三层魔杖店、带高阁楼的书店、低矮药剂店夹出一条 L 形内部巷道。入口朝 +Z，地块为 8×8 世界单位。临街砖墙定格在正在打开的状态：不规则窄缝、前后错动砖端，保留隐蔽感，不含动画。巷道先向里再右转，保持第二版收窄后的布局。

第三版根据用户提供的彩色魔法商店参考，将底商酒红、墨绿延伸至全部上层墙面与山墙，增加竖向凸窗、浅色细饰边、成组阶梯尖塔与金属顶饰。保留大老虎窗和悬挑房间。本版供继续审美迭代，不是整条电影街景的缩比复刻。

![正面](front.png)

![俯视](top.png)

![背面](back.png)

## 配色与实现

- 整栋酒红、墨绿墙面，旧红砖入口，共用蓝灰板岩屋顶和暖琥珀窗光；浅砂色仅作窄饰边，不作大面积墙底。
- 新增 `shopGreen`、`shopWine` 哑光漆木材质，用于底层店面和吊牌；使用既有 painted 表面着色，非金属、非自发光。
- `src/generators/diagonAlley.js` 是固定资产源，复用 UrbanMassingSpec、VoxelInstanceBuffer 与 greedy meshing；所有面位于 0.125 体素网格。
- 7742 三角形；已有/新建 2×2 斜角巷、放置预览、CPU 可视化共用工厂。非 2×2 历史记录保留旧路径。
- 不改变卡牌遮蔽效果、成本或其他玩法。巷道为资产内部视觉空间，不写入城市道路网络。
- CPU 预览采用简化日光，不完整代表游戏内 AO、动态阴影和夜间发光。

## 再生成

```sh
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/front.png front 1024
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/top.png top 512
pnpm visualize:building public/generated/diagon-alley-001/asset.json docs/visual-development/diagon-alley-001/back.png back 512
```

测试覆盖四向边界、体素网格、面数预算、入口窄缝与错位砖端、上层墙面配色、内巷两段及转角连续净空，以及城市/预览/可视化一致性。
