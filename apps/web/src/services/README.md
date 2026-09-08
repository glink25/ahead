# Web 数据服务

业务数据分为两个独立模型：可写工作区保存远端基线和本地修改 patch；只读资源缓存保存市场 Feed、他人资料和搜索命中。订阅关系属于工作区，订阅内容属于只读缓存，不会上传到个人仓库。

## 工作区与同步

页面通过 [workspace API](workspace.ts) 写入。[LocalWorkspaceAdapter](../adapters/local-workspace.ts) 始终负责 IndexedDB 事务；提交成功后发布同页与跨标签页变更。未登录也有完整访客工作区，没有同步绑定时不产生同步任务。

选择云端资料后，[同步调度器](../data/scheduler.ts) 调用独立 [SyncAdapter](../adapters/sync.ts)。GitHub 实现每次读取最新 `ahead.yaml`，用本地 patch 覆盖对应字段或事件后，只提交这一份标准 OEF 文档。仓库里的其他文件不会被读取、修改或清理。同步确认只移除本轮 operation，保留期间新增修改。

资源地址与状态分离：首次发布前使用 local 链接，确认后使用远端链接，继续编辑不退回 local。远端地址匹配当前账号的已关联工作区时，读取其最新本地投影及同步状态，并结束读取；不再走公开内容下载。地址映射和版本保存在工作区同一事务内。

## 只读查询与缓存

[MarketApi](market-api.ts) 提供市场会话、来源查询和事件派生。详情、来源列表共享 [ResourceQuery](resource-query.ts) 的快照和请求。取消一个消费者只分离该消费者；账号变化关闭旧查询，旧结果不能进入新作用域。

[Provider 接口](providers.ts) 分离市场目录和内容读取；搜索使用 [SearchProvider](search-feed-api.ts)。GitHub Issues、Code Search 和仓库读取留在 adapters 中。公开资源用通用 locator 与不透明 version 表示；相同版本复用正文。

[SearchQuery](search-query.ts) 管理分页、持久化和重新验证，React hook 不操作存储。查询快照只保存来源与命中事件 ID；正文进入共享缓存。完整 Feed 与按版本保存的部分搜索结果分开，部分结果不能覆盖完整频道或表示删除。已关联工作区的搜索命中从本地投影读取。

单个 `ahead` IndexedDB 使用 `workspace-v3`、`resources-v2`、`views-v2` 和 `auth`。旧开发数据不读取、不迁移、不删除。工作区不参与缓存淘汰；已加载的收藏、置顶、订阅内容受保护；普通资源快照最多 200 条，搜索索引最多 20 条，市场索引最多 60 条。登录时可复用访客已缓存的公开内容。

外部内容和搜索新鲜期为 5 分钟，市场新品探测为 6 小时。[refresh](refresh.ts) 集中处理聚焦、联网与可见期间每分钟的同步/刷新。旧内容在后台失败时保留。存储配额不足先清理可淘汰缓存和视图，再重试一次；工作区写入仍失败则报告保存失败。

## 传输边界

GitHub 普通请求发送到 `api.github.com`；只有 Code Search 经过 Auth Worker 的窄 relay。token 不进入内容缓存。资源缓存按认证身份隔离；资料派生结果随资料切换重建。私密同步不使用只读缓存。

图片沿用版本固定的 URL 和浏览器缓存；这里的离线保证针对已经保存的结构化内容，不自动下载整个源或媒体附件。后台同步在应用运行期间执行，下次打开继续未完成操作。
