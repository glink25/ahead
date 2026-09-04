# @ahead/web

Ahead 的 Vite + React Router 7 SPA。默认市场为 glink25/ahead，可用
`VITE_GITHUB_MARKET_REPOSITORY=owner/repo` 覆盖。没有 mock 内容。

- `/discover`：市场事件全屏海报流；分批从源仓库加载，仅挂载当前屏附近五张海报。
- `/mine?view=timeline|calendar`：图片时间轴与连续月历；日历支持 `scale=year|month|week` 和 `date=YYYY-MM-DD`，右下角打开事件编辑器。
- `/events/:id`：真实事件、来源链接与日期变化时间线。
- `/following`：独立管理同仓库多个 manifest 的订阅、推荐优先级与公开用户视角。
- `/studio`：日常事件表单、YAML 高级编辑与预览；本地保存、编辑、删除，登录后自动同步个人事件。
- `/settings`、`/login`：统一设置、自动同步状态与登录。`/profile`、`/me` 兼容跳转到设置。

我的与发现切换保留浏览位置，详情返回恢复原页面。左右滑动切 Tab；上下箭头翻发现卡片，左右箭头切 Tab，F 切换喜爱。
匿名资料与已读源使用 IndexedDB，网络失败回退缓存并显示可关闭的简短提示，详细诊断在设置中查看。
登录后在 `/profiles` 选择或新建个人资料；每份资料对应独立的公开或私密 UserData 仓库，可从我的页标题和设置切换。访客数据自动合入所选资料。Studio 事件存储在关联的同可见性 Personal Feed 仓库。收藏、兴趣、订阅和事件共享持久化与自动同步链路，详见 [同步架构](../../docs/profile-sync.md)。

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
生产构建包含 Service Worker，首次在线加载完成缓存后可断网刷新、打开编辑器和保存事件。开发服务器不注册 Service Worker。应用外壳缓存不包含认证请求或私人仓库响应；个人资料保存在本机 IndexedDB。首次访问仍需网络。

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

生产环境离线回归：`pnpm --filter @ahead/web test:offline`。同步端到端测试使用模拟 GitHub API，不创建真实仓库。
