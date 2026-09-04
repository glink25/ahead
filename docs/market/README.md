# Market

Ahead Market 使用同仓库 GitHub Issues 作为轻量发现注册表。事件和用户数据只以源仓库为事实来源；Issue 不复制事件全文。

## 提交与审核

1. 使用 Issue Forms 提交 Resource type、Locator 和 Manifest path（默认 ahead.yaml）。
2. workflow 固定源仓库当前 commit，读取公开 manifest 并按资源类型校验。
3. 成功：保留人工描述，写入元数据块，添加 approved 与 type:*，移除 needs-changes。
4. 失败：移除 approved，添加 needs-changes，并评论原因；保留其他标签。
5. 编辑表单字段优先于旧机器人块。回写前检查正文是否被并发编辑。

approved 只表示 validatedSha 的 manifest 通过 schema 校验，不代表人工事实核查，也不保证此后的源内容仍然有效。客户端仍须校验实际读取的版本与 eventsGlob 中的文件。

## 元数据格式

```html
<!-- ahead:source:{"schema":1,"locator":"github:alice/feed","manifestPath":"feeds/games.yaml","resourceType":"event-feed","name":{"zh-CN":"游戏发售"},"tags":["games"]} -->
```

可选字段：name、description、tags、validatedSha（完整 commit SHA）、validatedAt（ISO 时间）。
这是市场元数据，不是 EventFeed manifest。不要写入 events、schedule 或完整 YAML。

客户端兼容旧 ahead:manifest 注释块，网络失败且没有缓存时可把完整内联事件作为迁移期兜底；新审核不再生成此块。

## Web 加载

- 分页读取 open + approved Issues，忽略 PR，按 locator + manifestPath 去重。
- 发现只取当前市场中的 event-feed；订阅、喜爱不会将事件移出发现。
- 按源分批加载，最多三个并发任务。同一次刷新共用仓库版本解析；完整 SHA 不再重复解析。
- manifest、glob 文件与仓库图片使用相同 commit。缓存按资源身份、manifest 路径和 commit 隔离。
- 先展示本地缓存，后台刷新；单源失败不影响其他源，页面提示缓存/失败状态。
- 发现海报只挂载当前屏附近五张；已加载集合参与推荐，浏览期间保持顺序稳定。
- 仓库名称不等于源身份。subscriptions 新增可选 manifestPath；缺省仍指向 ahead.yaml，旧资料可直接读取。

## 迁移现有 Issues

先把新脚本及 workflow 部署到默认分支，再对现有 Issue 运行 Market triage 的 workflow_dispatch，填写 issue_number。
每次成功审核会删除旧内联 manifest，保留人工文字，写入轻量元数据。不需要重新创建 Issue。
不要在旧 workflow 仍生效时手动清理正文，否则旧脚本可能重新内联全文。

## 本地 dry-run

不设置 GITHUB_TOKEN 时不会写远端；已设置凭证时显式加 DRY_RUN=1：

    DRY_RUN=1 GITHUB_REPOSITORY=glink25/ahead ISSUE_NUMBER=1 pnpm market:triage

也可仅设置 ISSUE_BODY 提供表单正文。

## 下架

关闭 Issue 后，从下一次成功市场刷新起不再出现在发现。已有订阅继续从源仓库读取；单独喜爱的事件尽量从已知源与缓存恢复。离线时目录可能仍是上次缓存，界面会提示刷新失败。
