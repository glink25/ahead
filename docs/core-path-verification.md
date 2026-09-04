# 核心链路验证

## 自动化回归

在仓库根目录运行；脚本定义以 [package.json](../package.json)、[Web scripts](../apps/web/package.json)和 [CI](../.github/workflows/ci.yml)为准。

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @ahead/web exec playwright install chromium
pnpm test:e2e
pnpm --filter @ahead/web test:offline
```

单元测试覆盖协议与数据处理；端到端测试覆盖交互、资料隔离及模拟 GitHub 同步。离线测试独立构建生产资源，验证缓存后断网刷新与编辑保存。模拟测试不证明真实 OAuth 或部署可用。

## 真实 GitHub 双账号验收

仅在明确需要外部集成验收时执行：[脚本](../scripts/verify-live.mjs)会使用 glink24 / glink25 创建真实仓库、协作关系和临时 Market Issues。两个账号需预先登录本机 gh。

```bash
AHEAD_LIVE=1 node scripts/verify-live.mjs http://127.0.0.1:4455
```

也可指定线上 URL。脚本通过 PAT 登录，交叉核对界面、本地状态、GitHub manifest 及另一账号的读取结果；OAuth 登录、安装与刷新需另行浏览器验收。

报告写入被 Git 忽略的 artifacts/verification。通过 AHEAD_RESUME 指定之前的 report.json 可复用测试仓库；成功关闭临时 Issues，保留仓库供复验，失败保留现场。按报告中的资源清单清理，不按账号批量删除。凭证仅在进程内使用，不保存认证截图、storageState 或网络 trace。

资料协作约定见[同步说明](profile-sync.md)，发布与下架见 [Market](market/README.md)，公开读取边界见[浏览器服务](../apps/web/src/services/README.md)。
