# @ahead/web

Ahead 的 Vite + React 前端。默认使用内置事件和发现页 mock；配置
`VITE_GITHUB_MARKET_REPOSITORY=owner/repo` 后，发现页会读取该仓库的公开 Issues。

```bash
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm dev
```

OAuth 需要同时启动 `pnpm dev:auth`，并把 `VITE_AUTH_BASE_URL` 设为
`http://localhost:8787`。PAT 与 OAuth 凭证均写入浏览器 IndexedDB；Auth Worker
只负责授权跳转、App 安装引导与 refresh。页面刷新恢复登录态不依赖 Auth 是否在线。
当前 PWA 提供基础 Web App Manifest；如需离线缓存，后续可接入 service worker 或
`vite-plugin-pwa`。
