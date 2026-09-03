# GitHub 集成（公开说明）

面向贡献者与自托管用户：Ahead 如何用 GitHub 做存储与登录。

## 双认证

| 方式 | Provider | Token 存储 |
|---|---|---|
| classic PAT | `PersonalAccessTokenProvider` | IndexedDB（独立 store） |
| OAuth（GitHub App User authorization） | `GitHubOAuthProvider` + `apps/auth` | HttpOnly cookie + 内存短期 access token |

两者均通过 `getCredential()` 注入 Octokit；业务层不感知 token 来源。未配置 Auth Worker 时，UI 仅展示 PAT。不使用 GitHub App installation token。

自托管时自行部署 `apps/auth`（Cloudflare Worker），并用环境变量配置 Auth 基址与前端 Origin 白名单。

## 匿名只读

公开仓库优先 `CdnReadAdapter`：`cdn.jsdelivr.net/gh/{owner}/{repo}@{commitSha}/...`（用不可变 SHA，避免分支缓存延迟）。

## 本地 Auth Worker

```bash
cp apps/auth/.env.example apps/auth/.dev.vars
# 填入 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / STATE_SECRET / REDIRECT_URI_ALLOWLIST / FRONTEND_ORIGIN
pnpm dev:auth
```

Web `.env`：

```bash
VITE_AUTH_BASE_URL=http://localhost:8787
VITE_GITHUB_MARKET_REPOSITORY=glink25/ahead
```

内部 Spike、威胁模型、发布清单见本地 `docs/.local/architecture/`（不入库）。
