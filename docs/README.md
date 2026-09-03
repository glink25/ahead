# Ahead 文档

本目录区分两类文档：

| 路径 | 是否开源入库 | 用途 |
|---|---|---|
| [`protocol/`](./protocol/) | 是 | OEF 协议说明、给人类与 AI 的写作规范 |
| [`market/`](./market/) | 是 | 公开 Market（Issues 注册表）说明 |
| [`github/`](./github/) | 是 | 认证与仓库访问的公开集成说明 |
| **`.local/`** | **否**（已被 `.gitignore` 忽略） | 开发计划、产品手册草稿、Spike、威胁模型、发布清单、托管部署笔记等内部材料 |

本地开发文档请放在 `docs/.local/`（例如 `PLAN.md`、`ahead产品&开发手册.md`、`architecture/`、`deploy/`）。该路径不会进入 Git。

## 快速入口

- 协议概览：[protocol/README.md](./protocol/README.md)
- **给大模型的完整写作提示词**：[protocol/LLM_AUTHORING.md](./protocol/LLM_AUTHORING.md)
- Duration 语义：[protocol/duration.md](./protocol/duration.md)
- 机器权威源：[`packages/schema/schemas`](../packages/schema/schemas)
- 合法/非法样例：[`fixtures/`](../fixtures/)
