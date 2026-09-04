# Market

Market 使用 GitHub Issues 登记公开事件源和用户资料，供客户端发现。内容保存在源仓库，Issue 仅记录入口和简介。

## 发布与下架

1. 使用仓库的 [Issue Forms](../../.github/ISSUE_TEMPLATE)提交资源类型、仓库地址及 manifest 路径。
2. [审核 workflow](../../.github/workflows/market-triage.yml)固定源仓库版本并校验 manifest，成功后添加通过标签；失败时评论原因，修改表单后可重新审核。
3. 关闭 Issue 后，该源在下一次成功市场刷新时从发现目录移除；已有订阅仍可直接读取源仓库。离线缓存可能暂时保留旧目录。

审核通过只说明当时的 manifest 结构合法，不代表事实核查或后续版本有效。客户端仍会校验实际读取的内容，包括同仓库的事件文件。

## 源身份与读取

源由仓库地址和 manifest 路径共同标识，同仓库多个清单可独立订阅。公开文件与图片按同一 commit 读取，单源失败不阻断其他源；目录及缓存行为见[浏览器服务](../../apps/web/src/services/README.md)。

市场元数据的类型与编解码见 [types](../../packages/market/src/types.ts)、[format](../../packages/market/src/format.ts)，不属于 OEF manifest。旧内联格式的兼容行为也以该实现为准。

## 维护

旧 Issue 迁移：先将新审核脚本和 workflow 部署到默认分支，再通过 workflow_dispatch 指定 issue_number。审核会保留人工描述并更新元数据，不需要重建 Issue。

本地只读检查：

```bash
DRY_RUN=1 GITHUB_REPOSITORY=glink25/ahead ISSUE_NUMBER=1 pnpm market:triage
```

表单解析、并发编辑保护及回写逻辑见 [triage 脚本](../../scripts/market-triage.ts)。
