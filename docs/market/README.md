# Market

Ahead Market 使用 **同仓库 GitHub Issues** 作为发现注册表；真实 Feed / UserData 仍来自源仓库。本文档开源入库，供作者与贡献者使用。

开发用 triage 调试笔记、发布清单等见 `docs/.local/`（不入库）。

## 提交流程

1. 使用 Issue Forms（`.github/ISSUE_TEMPLATE/`）或纯文本提交，包含：
   - Resource type：`event-feed` / `user-data`
   - Locator：`github:owner/repo`
   - Manifest path：默认 `ahead.yaml`
2. `market-triage` workflow 拉取源仓 manifest，用 `@ahead/schema` 校验。
3. 成功：回写 HTML 注释块并打 `approved` + `type:*`。
4. 失败：评论原因，打 `needs-changes`，移除 `approved`。

## Issue 正文标记

```html
<!-- ahead:source:{"schema":1,"locator":"github:alice/feed","manifestPath":"ahead.yaml","resourceType":"event-feed"} -->
<!-- ahead:manifest:start -->
{ ...validated manifest json... }
<!-- ahead:manifest:end -->
```

客户端一次 Issues API（`labels=approved`）即可渲染列表，避免 N+1。

## 本地 dry-run

```bash
ISSUE_BODY='### Locator
github:alice/ahead-feed-games
### Manifest path
ahead.yaml' pnpm market:triage
```

## 下架

关闭 Issue 即从发现层消失；已有订阅不受影响。
