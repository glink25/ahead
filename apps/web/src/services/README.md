# 浏览器公开源服务

页面和 store 通过 [marketApi()](market.ts)读取市场与公开源。服务负责解析、校验、版本固定、缓存和请求调度，UI 不直接管理 GitHub 请求或源缓存。

事件、频道和用户详情使用路径中的 `local` / `github` 资源地址，并统一通过 `MarketApi.sources.open()` 读取。本地工作区内容同步成功后由服务把 canonical address 提升为 GitHub 地址；IndexedDB 缓存只是 GitHub 资源的读取方式，不改变其地址身份。

搜索独立于 Market。`SearchFeedApi` 在浏览器内负责编排，仓库检查与文件读取仍经 `OctokitAdapter` 直连 `api.github.com`。由于 GitHub Code Search 的实际 GET 响应并不稳定提供 CORS 头，只有 `/search/code` 通过 Ahead Auth Worker 的窄 relay 转发；本地随后完成协议校验和精确事件过滤。

搜索命中独立 Event 时，只读取命中文件及仓库内候选 EventFeed manifest，校验 `eventsGlob` 后组装临时 feed，不遍历 repository tree，也不下载 glob 下的其他事件。`useSearchFeed()` 负责 feed 合并、resolve、取消、渐进分页，并按身份保存最近的已验证查询快照。GitHub 返回 `incomplete_results` 时，已验证结果仍会交付，同时产生结果不完整警告。

接口与事件类型直接查看 [MarketApi](market-api.ts)，传输与限流实现查看 [PublicReadClient](public-read-client.ts)。

Discover 通过 `MarketApi.market.openSession()` 消费市场。页面只报告当前可见位置；本地恢复、6 小时一次的新品探测、低水位判断、单页扩容、分页游标和 Feed 懒加载全部封装在 API 会话内。推荐计算独立位于 `@ahead/recommendation`，不包含网络或存储逻辑。

## 消费约定

- 快照可先展示本地内容；流式更新按源身份幂等合并，取消消费使用 AbortSignal。
- 游标仅属于当前服务会话，用于暂停和恢复；不能作为持久书签。重新开始遍历可重新交付已见数据。
- 目录增量在遍历完成前不能用于判定下架；缓存目录可能暂时包含旧条目。
- 单源失败不阻断其他源；分页失败或限流会结束读取。即使存在缓存也保留错误状态，重试由调用方显式发起。

## 缓存与认证边界

应用只使用一个 `ahead` IndexedDB：workspace、认证、已验证资源和派生视图分别位于固定 object store。页面先交付本地快照，再在后台重新验证可变资源；传输响应只在内存中短暂复用。共享请求的取消只分离当前读者，其他读者可继续使用。

GitHub API 的凭证由应用认证层提供。普通 GitHub API 请求只发送到 `api.github.com`；Code Search token 发送给配置的 Auth Worker 并由其原样透传给 `api.github.com/search/code`。relay 必须校验允许的 Origin 和 Bearer token，只接受 Ahead 的 OEF 搜索查询及有限分页，不记录、不缓存 token 或搜索响应，调用额度归该 token 所属账号。公开和私有内容快照都按身份隔离；私密同步和写请求不经过内容缓存。
