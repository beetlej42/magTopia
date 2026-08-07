# MAGTOPIA 前端 Surface 与部署边界

MAGTOPIA 将渲染能力与对外页面分开管理。当前 dashboard 继续作为临时主页/运营入口，未来再替换成正式的公共展示首页。

## 页面职责

| Surface | 入口 | 用途 | 生产部署 |
| --- | --- | --- | --- |
| Dashboard | `/dashboard` | 订单、城市状态、运营信息 | 保留 |
| Player City | `/cities/:cityId` | 面向玩家的只读城市查看页 | 保留 |
| Agent Service | `/.well-known/magtopia-agent.json`、`/agent/*`、`/openapi.json` | Agent 发现、协议和 API | 保留 |
| Studio | `/studio` 或本地 `/` | 模式、预设、seed、参数和调试实验 | 不部署 |
| Acceptance | 本地 `/acceptance/agent-city` 或 `?view=1` | 固定场景视觉验收与 CI 辅助 | 不部署为产品入口 |

## 约束

- Studio 与 Acceptance 可以复用同一批 Three.js/generator 模块，但不应出现在生产导航或生产路由中。
- `/cities/:cityId` 自动进入 `player` surface，只显示城市信息和只读刷新能力，不显示模式、预设、seed、滑块或 API 调试信息。
- `?view=1` 和 `/acceptance/*` 自动进入 `acceptance` surface，隐藏产品 UI，保持固定验收画面。
- 当前服务端只将 `dist/index.html` 用作城市查看页，并没有 `/studio` 服务端路由；Studio 由 Vite 本地开发服务器使用。
- 将来建设正式公共首页时，可以新增 `showcase` surface，不需要把 Studio 重新暴露出去。

## 本地使用

```bash
pnpm dev:studio
# http://127.0.0.1:5173/studio

pnpm dev:acceptance
# http://127.0.0.1:5173/acceptance/agent-city?mode=agentcity&view=1
```
