# Ahead / 盼头

一个让人知道「未来还有什么值得期待」的开放事件流客户端。

> GitHub Repositories → Open Event Feed → Client-side Resolver → 盼头

## 特性

- **OEF v0.1** 协议（JSON Schema 权威源 + fixtures）
- **双登录**：GitHub PAT + OAuth（`apps/auth` Worker）
- **双 Tab**：发现海报流 / 我的时间轴与月历，匿名订阅、喜爱、隐藏与撤销
- **真实数据**：公开 Market / Feed 走 CDN 只读，IndexedDB 缓存与离线数据回退
- **Resolver / Recommendation**：确定性合并、时间桶推荐
- **Studio**：Form / YAML 共用 schema 校验
- **Market**：轻量 Issues 注册表 + triage 机器人；内容从源仓库读取，同仓库多 manifest 独立订阅

## 快速开始

需要 Node.js 20+ 与 pnpm 9：

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

OAuth（可选）：

```bash
cp apps/auth/.env.example apps/auth/.dev.vars
pnpm dev:auth
```

## 文档

| 路径 | 说明 |
|---|---|
| [docs/README.md](docs/README.md) | 文档索引（开源 vs 本地） |
| [docs/protocol/](docs/protocol/) | OEF 协议 |
| [docs/protocol/LLM_AUTHORING.md](docs/protocol/LLM_AUTHORING.md) | **给 AI 的完整写作提示词**（可直接生成合法 Feed） |
| [docs/market/](docs/market/) | Market 注册表 |
| [docs/github/](docs/github/) | GitHub 认证与仓库访问 |

开发计划、产品手册草稿、Spike / 威胁模型等**内部材料**放在 `docs/.local/`（已被 Git 忽略，不进入开源仓库）。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @ahead/web exec playwright install chromium
pnpm test:e2e
pnpm exec tsx scripts/bench-recommend.ts
```

Market triage dry-run：

```bash
ISSUE_BODY='### Locator
github:example/feed
### Manifest path
ahead.yaml' pnpm market:triage
```

## 目录

| 路径 | 说明 |
|---|---|
| `apps/web` | React SPA |
| `apps/auth` | Cloudflare Worker OAuth |
| `packages/*` | schema / core / github / resolver / … |
| `schemas/v0.1/` | 可发布的 Schema 副本 |
| `fixtures/` | 合法 / 非法协议样例 |
| `examples/` | 示例 Feed / UserData |

## 许可

MIT
