# @ahead/web

Ahead 的 Vite + React Router 7 SPA。默认市场为 glink25/ahead，可用
`VITE_GITHUB_MARKET_REPOSITORY=owner/repo` 覆盖。没有 mock 内容。

- `/discover`：市场事件全屏海报流；分批从源仓库加载，仅挂载当前屏附近五张海报。
- `/mine?view=timeline|calendar`：订阅源事件、单独喜爱与 pins；时间轴严格按日期排列。
- `/events/:id`：真实事件、来源链接与日期变化时间线。
- `/following`：独立管理同仓库多个 manifest 的订阅、推荐优先级与公开用户视角。
- `/studio`、`/profile`、`/login`：表单/YAML 编辑、个人设置、显式远端同步与登录。

左右滑动切 Tab；上下箭头翻发现卡片，左右箭头切 Tab，F 切换喜爱。
匿名资料与已读源使用 IndexedDB，网络失败回退缓存并显示提示。
远端同步需在个人页填写已有 UserData 仓库和路径，然后显式点击合并同步；版本冲突不会强制覆盖。

```bash
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm dev
```

OAuth 需要同时启动 `pnpm dev:auth`，并把 `VITE_AUTH_BASE_URL` 设为
`http://localhost:8787`。授权成功后 Auth 会带着 `github_authorized` 回到 `/login`；
应用模块启动时消费该参数、写入 IndexedDB，再用 `history.replaceState` 清掉地址栏。
PAT 与 OAuth 凭证均写在本机
IndexedDB；刷新恢复登录不依赖 Auth 是否在线。开发时 Vite 已 alias 到 packages 源码。
当前有基础 Web App Manifest，但没有 service worker：已加载的应用可离线读资料/事件缓存；完全断网时首次加载应用外壳不在支持范围内。

## Cloudflare 响应头

`public/_headers` 随构建复制到 `dist/_headers`。不设置 Content-Security-Policy 或
Content-Security-Policy-Report-Only，也没有 HTML meta CSP；保留 nosniff、Referrer-Policy
和 X-Frame-Options。当前 Ajv 校验器在浏览器中动态编译，禁止动态求值的 CSP 会阻止源数据校验。
CSP 与 Cookie 登录机制无关；移除 CSP 也意味着不再提供该策略的脚本和资源加载限制。

修改后需要重新部署 Cloudflare Pages。若部署后响应仍带 CSP，应检查 Cloudflare 控制台的
响应头变换规则或额外的 Worker/代理策略；这类外部规则不由本仓库控制。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @ahead/web exec playwright install chromium
pnpm test:e2e
```

Playwright 使用独立 4466 端口，覆盖桌面/移动端交互与网络失败恢复。测试网络数据只存在 e2e 文件中。
