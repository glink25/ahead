# Ahead / 盼头

让人知道「未来还有什么值得期待」。

游戏发售、一次旅行、一场演出，或自己计划的小事——盼头把这些未来事件放在一起，让你发现感兴趣的内容，订阅持续更新的事件流，收藏期待，并在时间轴与月历中安排自己的生活。

- **发现与记录**：浏览公开事件，也可以写下自己的盼头；日期尚未确定时，保留月份、季度或未知时间。
- **属于自己的视角**：订阅、收藏和个人事件组成你的资料，支持多份公开或私密资料。
- **开放且可携带**：事件使用开放的 OEF 协议，以 YAML / JSON 保存在 GitHub 仓库；Market 帮助发现内容，源仓库保存内容本身。
- **离线也能继续**：首次在线缓存后，可以离线查看和编辑；登录后将本机修改同步到自己的仓库。

## 用 AI 编写事件流

把下面这句话交给能读取 GitHub 文档的 AI，替换其中的主题即可：

> 根据 Ahead 协议（https://github.com/glink25/ahead/blob/main/docs/protocol/README.md），为我编写一个节假日事件流 ahead.yaml。

[协议与示例](docs/protocol/README.md)提供格式说明及 Schema 入口。生成后可在 Studio 的 YAML 编辑器中校验；准备公开分享时，参见 [Market](docs/market/README.md)。

## 本地运行

使用 Node.js 22 与 pnpm 9（与当前 CI 一致）：

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

配置与部署见 [Web 开发说明](apps/web/README.md)，其余入口见[文档索引](docs/README.md)。

## 许可

[MIT](LICENSE)
