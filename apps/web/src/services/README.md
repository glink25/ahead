# 浏览器公开源服务

页面和 store 通过 [marketApi()](market.ts)读取市场与公开源。服务负责解析、校验、版本固定、缓存和请求调度，UI 不直接管理 GitHub 请求或源缓存。

搜索独立于 Market。`SearchFeedApi` 使用浏览器本地保存的 OAuth 或 PAT 凭证，经 `OctokitAdapter` 直接调用 `api.github.com`，Ahead Auth Worker 不代理搜索。GitHub Code Search 只召回同时包含查询词、OEF 结构特征和根级 `oefSearch: oef-search-v1` 标记的候选文件；本地随后完成协议校验和精确事件过滤。

搜索命中独立 Event 时，只读取命中文件及仓库内候选 EventFeed manifest，校验 `eventsGlob` 后组装临时 feed，不遍历 repository tree，也不下载 glob 下的其他事件。公开仓库的 commit/path 文件可进入身份隔离的 immutable 缓存；私有文件与查询响应只存在于当前 session 内存。`useSearchFeed()` 负责 feed 合并、resolve、取消和渐进分页，页面不接触 GitHub 传输细节。GitHub 返回 `incomplete_results` 时，已验证结果仍会交付，同时产生结果不完整警告。

接口与事件类型直接查看 [MarketApi](market-api.ts)，传输与限流实现查看 [PublicReadClient](public-read-client.ts)。

Discover 通过 `MarketApi.market.openSession()` 消费市场。页面只报告当前可见位置；本地恢复、6 小时一次的新品探测、低水位判断、单页扩容、分页游标和 Feed 懒加载全部封装在 API 会话内。推荐计算独立位于 `@ahead/recommendation`，不包含网络或存储逻辑。

## 消费约定

- 快照可先展示本地内容；流式更新按源身份幂等合并，取消消费使用 AbortSignal。
- 游标仅属于当前服务会话，用于暂停和恢复；不能作为持久书签。重新开始遍历可重新交付已见数据。
- 目录增量在遍历完成前不能用于判定下架；缓存目录可能暂时包含旧条目。
- 单源失败不阻断其他源；分页失败或限流会结束读取。即使存在缓存也保留错误状态，重试由调用方显式发起。

## 缓存与认证边界

可变资源重新验证，固定 SHA 内容复用缓存。共享请求的取消只分离当前读者，其他读者可继续使用。TTL、并发及请求间隔以传输实现为准。

GitHub API 的凭证由应用认证层提供，只发送到 `api.github.com`；公开响应缓存与限流状态按身份隔离，私密同步和写请求不走此缓存。限流协调仅限当前客户端实例，不能跨标签页或设备；限流期间已有新鲜缓存仍可读取。
