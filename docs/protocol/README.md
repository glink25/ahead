# Open Event Feed（OEF）v0.1

OEF 用 YAML 或 JSON 描述未来事件及个人关注的内容，Ahead 根据这些源数据计算时间轴、日历和推荐。

## 格式入口

编写事件流可从下方完整 `ahead.yaml` 示例开始。完整字段与约束以 [JSON Schema 源文件](../../packages/schema/schemas)为准，按所需对象读取对应文件及其 `$ref` 引用：

- 事件流：[EventFeed](../../packages/schema/schemas/event-feed.json) → [Event](../../packages/schema/schemas/event.json) → [ScheduleTimeline](../../packages/schema/schemas/schedule-timeline.json)、[TemporalValue](../../packages/schema/schemas/temporal-value.json)。
- 个人资料：[UserData](../../packages/schema/schemas/user-data.json)；持续与重复：[Duration](../../packages/schema/schemas/duration.json)、[Recurrence](../../packages/schema/schemas/recurrence.json)。
- 程序接入：[TypeScript 类型](../../packages/schema/src/types.ts)、[校验器](../../packages/schema/src/index.ts)；边界样例见 [fixtures](../../fixtures)。

Schema 是结构约束的权威源；TypeScript 类型用于程序接入，[schemas/v0.1](../../schemas/v0.1)是发布副本。

## 核心语义

- **Event** 是一件具体的事；**EventFeed** 汇集事件；**UserData** 保存个人订阅、收藏和偏好。
- Feed 可以内嵌 `events`，或用 `eventsGlob` 引用同仓库文件，不组合其他 Feed。UserData 可以订阅事件流或其他用户资料；关注用户在 Ahead 中参考其公开收藏，不继承其订阅。
- 标题等多语言文本使用语言代码到文本的映射，例如 `title: { zh-CN: 示例活动 }`。
- `schedule` 保存开始时间及其变化记录；日期不确定时使用相应精度，不虚构精确日期。当前条目的选择顺序见 [schedule 实现](../../packages/resolver/src/schedule.ts)。
- `duration` 表示每次开始后持续多久，`recurrence` 表示重复发生；`range` 表示开始时间的不确定窗口，不能用来表示活动持续区间。
- 倒计时、推荐分和展开后的 Occurrence 属于计算结果，不写入源数据；自定义字段放在 Schema 允许的 `extensions` 中。

真实事件的日期、置信度和证据应符合来源。节假日的放假与调休安排需按对应年份的可靠公告确认，不能用固定年度重复规则推断每年的实际假期。

## 完整事件流示例

以下为虚构活动，不代表真实安排。保存为仓库的 `ahead.yaml`；示例只使用内嵌事件，无需其他文件。

```yaml
oefVersion: "0.1"
kind: event-feed
id: demo-events
name:
  zh-CN: 示例活动
events:
  - id: autumn-reading-days
    title:
      zh-CN: 秋日阅读会（虚构）
    schedule:
      - id: announced
        value:
          kind: exact
          date: "2027-10-01"
        recordedAt: "2027-08-01T00:00:00Z"
        confidence: confirmed
    duration:
      amount: 3
      unit: days
```

日期锚点配合 days / weeks 时，时长包含首日；此例覆盖 10 月 1–3 日，计算出的结束边界为 10 月 4 日 00:00 UTC，不包含该边界。datetime 或 minutes / hours 使用固定时长相加；模糊时间不计算精确结束时刻。计算与重复跨度限制见 [duration 实现](../../packages/resolver/src/duration.ts)，这些运行时限制不由 Schema 校验代替。

以下是可用于上述事件的局部片段，并非完整文件：

```yaml
# 替换 schedule 条目的 value：只知道月份
value: { kind: month, year: 2027, month: 10 }
```

```yaml
# 添加到 Event：每年重复，共三次（虚构活动的固定安排）
recurrence: { freq: yearly, count: 3 }
```

## 个人资料示例

以下为完整 UserData，仓库地址为示意；替换成实际事件源后使用。省略 manifestPath 时读取 `ahead.yaml`，同仓库的其他清单可指定独立路径。

```yaml
oefVersion: "0.1"
kind: user-data
id: demo-profile
displayName:
  zh-CN: 我的盼头
subscriptions:
  - locator: github:example/events
    kind: event-feed
favorites:
  - autumn-reading-days
```

协议校验只确认数据结构，不证明事件事实准确或远端仓库可访问。公开发布流程见 [Market](../market/README.md)，个人资料的保存与合并见[资料与同步](../profile-sync.md)。
