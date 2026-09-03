# GitHub 集成（公开说明）

面向贡献者与自托管用户：Ahead 如何用 GitHub 做存储与登录。

## 双认证

| 方式 | Provider | Token 存储 |
|---|---|---|
| classic PAT | `PersonalAccessTokenProvider` | IndexedDB（`github-pat`） |
| OAuth（GitHub App User authorization） | `GitHubOAuthProvider` + `apps/auth` | IndexedDB（`github-oauth`）；Auth 仅中转 code→token / refresh，并引导安装 App |

两者均通过 `getCredential()` 注入 Octokit；业务层不感知 token 来源。未配置 Auth Worker 时，UI 仅展示 PAT。不使用 GitHub App **installation token** 建仓，但 OAuth 回调会检查用户是否已安装 App；未安装则先跳转安装页。安装完成后 GitHub 打回 **Auth Setup URL**（与 Callback 相同的后端 API），由服务端把已密封的 token 经 `github_authorized` 带回前端落盘。

自托管时自行部署 `apps/auth`（Cloudflare Worker），并用环境变量配置 Auth 基址、App slug 与前端 Origin 白名单。

## 匿名只读

公开仓库优先 `CdnReadAdapter`：`cdn.jsdelivr.net/gh/{owner}/{repo}@{commitSha}/...`（用不可变 SHA，避免分支缓存延迟）。

## 本地 Auth Worker

```bash
cp apps/auth/.env.example apps/auth/.dev.vars
# 填入 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_APP_SLUG / STATE_SECRET / REDIRECT_URI_ALLOWLIST / FRONTEND_ORIGIN
pnpm dev:auth
```

Web `.env`：

```bash
VITE_AUTH_BASE_URL=http://localhost:8787
VITE_GITHUB_MARKET_REPOSITORY=glink25/ahead
```

刷新登录态只读 IndexedDB，不要求 Auth 常开；新登录与令牌刷新仍需 Auth。

内部 Spike、威胁模型、发布清单见本地 `docs/.local/architecture/`（不入库）。
