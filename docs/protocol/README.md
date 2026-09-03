# OEF Protocol v0.1

Open Event Feed（OEF）是 Ahead 的数据协议。JSON Schema 位于 [`packages/schema/schemas`](../../packages/schema/schemas)，为唯一权威源。

**给大模型直接写合法事件流**：请使用完整提示词文档 → [`LLM_AUTHORING.md`](./LLM_AUTHORING.md)。

## 对象

| 对象 | 说明 |
|---|---|
| Event | 一件具体值得等待的事 |
| EventFeed | 一组 Event（内容） |
| UserData | 一个 Profile 对世界的视角 |
| Patch | 用户对某 Event 字段的本地覆盖 |
| LocalizedText | BCP 47 键文本映射 |
| ScheduleTimeline | 日期演变历史；当前值由客户端解析 |
| TemporalValue | exact / datetime / month / quarter / year / range / unknown |
| Duration | 每次 Occurrence 开始之后持续多久（可选）；详见 [duration.md](./duration.md) |
| Evidence | 支撑 schedule 的证据 |
| Recurrence | 有界重复规则 |
| Locator | `github:owner/repo`（v1） |

## Duration vs Range

| | `duration` | `TemporalValue.range` |
|---|---|---|
| 回答 | 持续多久 | 何时开始仍不确定 |
| 例子 | 国庆连休 7 天 | 「大概 2027 年上半年」 |
| 与 recurrence | 每次展开共用同一 duration | 不应用来表达多日活动 |

```text
Occurrence.start  ← schedule 锚点 + recurrence
Occurrence.end    ← start + duration（无 duration 则无 end）
```

日历日约定：`unit: days|weeks` 且锚点为 date-only 时，`amount: N` 表示含首日共 N 个日历日；运行时 `end` 为排他边界（`start + N days` 的 00:00 UTC）。

`minutes` / `hours` 或 `datetime` 锚点：`end = start + amount × unit`。

模糊锚点（month/quarter/year/unknown/range）可携带 duration，但不计算精确 `end`。

若 `duration` 跨度 ≥ recurrence 间隔（Occurrence 会重叠），Resolver **硬拒绝**。

## 规则摘要

1. 未知根字段拒绝；`extensions` 内未知键完整保留。
2. Source ≠ Computed：倒计时、推荐分、Occurrence 不入库。
3. Feed 不组合 Feed；资源边仅 `User → Feed` / `User → User`。
4. 订阅可选 `priority: -3..3`，默认 `0`。
5. Schedule 选择：可信度 → 精度 → 时间 → 稳定键。

## Fixtures

`fixtures/valid` / `fixtures/invalid` 由 `@ahead/schema` 测试驱动。

## 版本

当前冻结目标：`oef-v0.1.0`（含 duration 字段；缺省时旧数据无 end）。
