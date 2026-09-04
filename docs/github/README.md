# GitHub 集成

GitHub 仓库保存事件和个人资料，仓库可见性决定公开或私密访问。登录支持 PAT 与 GitHub App 用户 OAuth；业务层通过统一凭证接口访问仓库。

## 登录与部署

PAT 与 OAuth 凭证保存在本机 IndexedDB；刷新页面可从本机恢复登录。新 OAuth 登录和令牌刷新需要 `apps/auth` Worker，它负责授权交换、刷新及 App 安装引导。未配置 Auth 地址时只提供 PAT 登录。

本地启用 OAuth，在仓库根目录执行：

```bash
cp apps/auth/.env.example apps/auth/.dev.vars
# 按文件注释填写 GitHub App 和授权配置
pnpm dev:auth
```

Web 的 Auth 地址见 [Web 环境模板](../../apps/web/.env.example)，App 凭证与允许的前端 Origin 见 [Auth 环境模板](../../apps/auth/.env.example)。自托管时部署 Worker，并按实际前后端地址设置 GitHub App 回调及允许的 Origin；回调与安装流程见 [Auth 实现](../../apps/auth/src/index.ts)。

## 访问边界

公开内容可通过固定 commit SHA 的 CDN 地址读取；GitHub API 凭证只发送到 GitHub API 域名。认证和私密同步不使用公开内容缓存，具体策略见[浏览器服务](../../apps/web/src/services/README.md)。

接口与实现入口：[认证类型](../../packages/core/src/auth/types.ts)、[仓库接口](../../packages/core/src/repository/types.ts)、[GitHub 适配层](../../packages/github/src/index.ts)。个人资料的仓库关联及冲突处理见[同步说明](../profile-sync.md)。
