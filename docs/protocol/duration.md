# Duration

Event 可选字段 `duration: { amount, unit }` 与 schedule / recurrence 正交。

- schedule = 何时开始
- duration = 持续多久
- recurrence = 多久发生一次

`TemporalValue.range` **不**表示活动长度。完整生成规范见 [LLM_AUTHORING.md](./LLM_AUTHORING.md)；语义摘要见 [README.md](./README.md)。

客户端推荐：进行中事件（`now ∈ [start, end)`）落入 `0-7d` 桶，并加 `ongoingBoost`（默认 2）。
