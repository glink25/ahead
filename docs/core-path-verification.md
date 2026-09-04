# 核心链路验证

## 默认回归

`pnpm test` 先构建工作区包再执行测试，避免干净检出缺少包入口。
执行 `pnpm typecheck`、`pnpm build`、`pnpm test:e2e`；生产离线外壳另执行
`pnpm --filter @ahead/web test:offline`。

## 真实 GitHub 双帐号验收

此测试会在 glink24 / glink25 创建真实公开资料与事件仓库，建立测试协作关系，
提交临时 Market Issues 并等待实际 workflow 审核。仅在明确要运行外部集成验收时执行：

```sh
AHEAD_LIVE=1 node scripts/verify-live.mjs http://127.0.0.1:4455
```

两个帐号须预先在 `gh auth` 中登录。脚本从本机凭证存储读取令牌，只保存在进程内存；
不输出令牌，不保存认证截图、浏览器 storageState 或网络 trace。它通过访问令牌 UI
进行登录；GitHub App OAuth 的登录、安装与刷新需要单独真实浏览器验收。

可以对线上 URL 执行同一脚本。通过 `AHEAD_RESUME=artifacts/verification/<run>/report.json`
复用前次测试仓库；本轮并发事件使用独立标识。报告和结果截图写入被 Git 忽略的
`artifacts/verification/`。失败不清除现场；成功关闭临时 Market Issues，保留测试仓库
供复验。中断产生的登记和仓库根据报告资源清单清理，不能按帐号范围批量删除。

验收交叉核对 UI、IndexedDB 中的同步状态和待发送数量、GitHub 标准 manifest、
另一帐号的读取结果。Mock 通过不代表真实帐号、OAuth 或部署通过。

## 链路约定

- 公开分享包含事件源与用户资料两类 Market 资源。关注用户只参考公开收藏，
  不继承其订阅或私人视图，个人事件需要单独订阅。
- 用户推荐频率 -3…3 对收藏推荐信号的权重为 `2^(priority/3)`，默认 1，
  两端分别为 0.5 与 2；推荐总分仍遵循既有上限。同一源只计一次，源身份由仓库地址
  与 manifest 路径确定，不能仅依赖可能重复的 UserData.id。
- 共同编辑资料需要对 UserData 与关联 Personal Feed 两个仓库均有写入权限。
  Feed 的 id/name 是共享元数据，不能由另一设备的本地资料标识覆盖。
- 动态分支、权限与目录读取跳过浏览器 HTTP 缓存；固定 commit 的公开文件仍使用 CDN。
  登录用户的公开 GitHub API 元数据请求使用其帐号配额，凭证不发送到 CDN/raw 域名。
- 同步事务内部的每次 HTTP 凭证获取都检查会话有效性；切换帐号后不继续旧任务的后续请求。
