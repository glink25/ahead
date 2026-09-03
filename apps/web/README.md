# @ahead/web

Ahead 的 Vite + React 前端。默认使用内置事件和发现页 mock；配置
`VITE_GITHUB_MARKET_REPOSITORY=owner/repo` 后，发现页会读取该仓库的公开 Issues。

```bash
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm dev
```

OAuth 需要同时启动 `pnpm dev:auth`，并把 `VITE_AUTH_BASE_URL` 设为
`http://localhost:8787`。授权成功后 Auth 会带着 `github_authorized` 回到 `/login`；
应用模块启动时消费该参数、写入 IndexedDB，再用 `history.replaceState` 清掉地址栏
（不使用内联脚本，以兼容生产 CSP `script-src 'self'`）。PAT 与 OAuth 凭证均写在本机
IndexedDB；刷新恢复登录不依赖 Auth 是否在线。开发时 Vite 已 alias 到 packages 源码。
当前 PWA 提供基础 Web App Manifest；如需离线缓存，后续可接入 service worker 或
`vite-plugin-pwa`。
