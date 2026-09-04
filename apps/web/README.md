# Web 开发

Ahead 的 React / Vite 客户端。产品介绍见[项目首页](../../README.md)，路由以 [App](src/app/App.tsx) 为准。

## 本地运行

在仓库根目录执行：

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

市场仓库与 Auth 地址配置见 [.env.example](.env.example)。OAuth 可选；需要时按 [GitHub 集成](../../docs/github/README.md)启动 Auth Worker。

## 部署与离线

执行根目录 `pnpm build`，将 `apps/web/dist` 部署到静态站点托管服务；Cloudflare Pages 的路由回退和响应头分别由 [_redirects](public/_redirects)、[_headers](public/_headers)提供。构建与开发代理配置见 [vite.config.ts](vite.config.ts)。

生产构建缓存应用外壳；首次在线缓存完成后可离线刷新、编辑与保存，开发服务器不注册 Service Worker。缓存边界见 [offline-plugin.ts](offline-plugin.ts)，资料保存机制见[同步说明](../../docs/profile-sync.md)。

当前浏览器校验器使用 Ajv 动态编译。若托管层添加禁止动态求值的 CSP，会影响校验；仓库的响应头未配置 CSP。部署行为与限制由[部署策略测试](src/deployment-policy.test.ts)核对，外部代理或平台规则需单独检查。

## 验证与代码入口

测试命令集中在[核心链路验证](../../docs/core-path-verification.md)。[公开源服务](src/services/README.md)负责读取市场内容，[data](src/data)负责本地资料与远端同步；功能页面通过这些边界访问数据。
