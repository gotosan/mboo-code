# Agent Session JSONL 事件日志设计

## 目标

每个 agent session 的对话和执行过程保存为一个 JSONL 文件。JSONL 中每一行都是一个完整事件，用于支撑：

- 前端恢复会话历史。
- 前端展示 agent 的消息状态和最终回复。
- 服务重启后识别未完成 turn。
- 作为后续 agent 构建聊天记忆的事实来源。

当前版本优先简单落地，不记录完整模型输入快照，不设计具体工具清单和授权闭环，但会落地通用工具调用事件，支撑前端展示 agent 执行过程。

## 核心概念

### Session

一次完整会话。一个 session 对应一个主 JSONL 文件。

当前约束：

- 一个 session 内不允许并发 turn。
- 同一时间最多只有一个 running turn。
- JSONL 按追加写入。
- 事件一旦写入，默认不修改、不删除。

### Turn

一次用户请求以及 agent 随后的工作。当前版本一个 turn 主要包含：

- `TURN_STARTED`
- `USER_MESSAGE`
- `ASSISTANT_MESSAGE state=completed/interrupted`
- `TURN_COMPLETED` / `TURN_FAILED` / `TURN_CANCELLED`

### Event

JSONL 中的一行。事件记录 session 中已经发生的事实。每一行必须是完整 JSON，不能把流式文本追加到同一个未完成 JSON 对象中。

## 事件信封

每一行 JSONL 使用统一事件信封：

```java
public class SessionEvent {
    private String eventId;
    private String sessionId;
    private String turnId;

    private EventType type;
    private EventSource source;

    private OffsetDateTime createdAt;

    private JsonNode payload;

    private Map<String, Object> meta;
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `eventId` | 事件唯一标识。使用雪花 ID，具备趋势递增能力，可用于去重、分页游标和索引查询。 |
| `sessionId` | 当前 session 标识。 |
| `turnId` | 当前 turn 标识。session 级事件可以为空或使用固定值。 |
| `type` | 事件类型。 |
| `source` | 事件来源，例如 `USER`、`ASSISTANT`、`SYSTEM`。 |
| `createdAt` | 事件创建时间。 |
| `payload` | 事件主体，根据 `type` 反序列化为具体 payload。 |
| `meta` | 扩展字段，用于调试信息、兼容信息或临时实验字段。 |

## 事件类型

当前版本保留以下事件类型：

```java
public enum EventType {
    TURN_STARTED,
    TURN_COMPLETED,
    TURN_FAILED,
    TURN_CANCELLED,
    TURN_SUPERSEDED,

    USER_MESSAGE,
    TOOL_CALL_STARTED,
    TOOL_CALL_COMPLETED,
    TOOL_CALL_FAILED,
    TOOL_CALL_UNKNOWN,
    ASSISTANT_MESSAGE_DELTA,
    ASSISTANT_MESSAGE
}
```

其中 `ASSISTANT_MESSAGE_DELTA` 只用于 SSE 运行时推送，不写入 JSONL 主事件日志。

## 关键事件 Payload

### Turn 开始

```java
public class TurnStartedPayload {
    private String trigger;
    private String userMessageId;
}
```

`trigger` 示例：

- `user`
- `retry`
- `resume`
- `edit_resend`

### Turn 被替换

用户编辑后重新发送、模型错误后重新发送、用户取消后重新发送时，不修改旧 turn，也不删除旧事件，而是追加替换事件。

```java
public class TurnSupersededPayload {
    private String supersededByTurnId;
    private String reason;
    private boolean hiddenInNormalView;
}
```

普通聊天视图过滤 `hiddenInNormalView = true` 的旧 turn。审计回放可以展示全部事件。

### 用户消息

```java
public class UserMessagePayload {
    private String messageId;
    private String text;
    private List<AttachmentRef> attachments;
}
```

### Assistant 文本增量

`ASSISTANT_MESSAGE_DELTA` 通过 SSE 推送，不写入 JSONL。第一条增量即表示助手消息已经开始，前端可以使用其中的 `messageId` 创建或定位正在流式展示的 assistant 消息。

```java
public class AssistantTextDeltaPayload {
    private String messageId;
    private String text;
}
```

### Assistant Message

`ASSISTANT_MESSAGE` 使用 `state` 记录助手消息终态。当前版本不持久化助手消息开始事件，也不单独推送开始事件。

完成：

```json
{
  "messageId": "msg_...",
  "state": "completed",
  "text": "完整回复",
  "finishReason": "stop",
  "durationMs": 1234
}
```

中断：

```json
{
  "messageId": "msg_...",
  "state": "interrupted",
  "text": "已流出的部分回复",
  "reason": "client_disconnected",
  "errorMessage": null,
  "durationMs": 1234
}
```

`state` 取值：

- `completed`：助手消息正常完成，`text` 是完整回复。
- `interrupted`：助手消息中断，`text` 是已经流给前端并保存在后端内存中的部分回复。

`reason` 示例：

- `client_disconnected`
- `model_error`

### 工具调用

工具事件作为独立事件写入 JSONL，并通过 SSE 推给前端。第一版只定义通用事件协议，不在这里规定具体工具列表、敏感操作授权和工具参数 schema。

后端只输出稳定的 `toolName`，前端根据 `toolName` 控制展示文案、图标和国际化，不在事件 payload 中额外保存 `displayName`。

开始：

```json
{
  "messageId": "msg_...",
  "toolCallId": "call_...",
  "toolName": "getWeather",
  "arguments": "{\"city\":\"杭州\"}"
}
```

完成：

```json
{
  "messageId": "msg_...",
  "toolCallId": "call_...",
  "toolName": "getWeather",
  "arguments": "{\"city\":\"杭州\"}",
  "resultPreview": "杭州当前天气：...",
  "errorCode": null,
  "errorMessage": null,
  "durationMs": 1234
}
```

失败时使用 `TOOL_CALL_FAILED`，`errorCode` 和 `errorMessage` 记录失败摘要。服务恢复或回放时如果发现 `TOOL_CALL_STARTED` 没有对应的 completed/failed/unknown，可以追加 `TOOL_CALL_UNKNOWN` 表示结果不可确认。

## 流式文本策略

assistant 的流式文本增量只通过 SSE 推给前端，并在后端内存中累积，不作为 JSONL 主事件持久化。

推荐运行时流程：

1. 写入 `TURN_STARTED` 和 `USER_MESSAGE`。
2. 模型流式返回增量时，后端通过 SSE 固定事件名 `session_event` 发送 `SessionEvent`，前端按 `data.type=ASSISTANT_MESSAGE_DELTA` 处理文本增量。
3. 模型准备执行工具时写入并推送 `TOOL_CALL_STARTED`。
4. 工具执行结束时写入并推送 `TOOL_CALL_COMPLETED` 或 `TOOL_CALL_FAILED`。
5. 后端用内存 buffer 累积已流出的文本。
6. 模型正常完成时写入 `ASSISTANT_MESSAGE state=completed`。
7. 用户主动停止、客户端断开或出现可捕获错误时写入 `ASSISTANT_MESSAGE state=interrupted`。

如果模型没有返回任何文本增量但正常结束，前端应以最终的 `ASSISTANT_MESSAGE` 创建或更新助手消息。

如果服务进程硬崩溃、JVM 退出或机器断电，内存中的已流出文本可能还没来得及落盘，此时 JSONL 只能恢复到最近一个完整事件。

## 恢复规则

### 普通聊天历史恢复

1. 按文件行顺序读取 JSONL。
2. 使用 `eventId` 去重。
3. 过滤被 `TURN_SUPERSEDED` 且 `hiddenInNormalView = true` 的旧 turn。
4. 渲染 `USER_MESSAGE`。
5. 渲染 `ASSISTANT_MESSAGE state=completed` 的 `text`。
6. 对 `ASSISTANT_MESSAGE state=interrupted` 展示部分文本和中断状态。

### 服务重启后继续执行

1. 读取最新 session JSONL。
2. 定位最后一个未完成 turn。
3. 如果存在 `ASSISTANT_MESSAGE state=interrupted`，恢复其中的 `text`。
4. 如果 turn 已开始但没有 `ASSISTANT_MESSAGE state=completed/interrupted`，说明服务可能硬崩溃在流式回复中间，已流出但未落盘的内存文本不可恢复。
5. 当前版本不自动续跑模型，由后续恢复流程决定是重试、失败还是询问用户。

## 后续扩展

当前版本不落地上下文快照或完整模型调用事件。后续需要更强审计和恢复能力时，可以追加：

- `CONTEXT_SNAPSHOT_CREATED`：记录某次真正发给模型的完整上下文。
- `APPROVAL_REQUIRED` / `APPROVAL_RESOLVED`：记录敏感工具调用的用户授权过程。

这些扩展应保持独立事件，不塞进 `ASSISTANT_MESSAGE`。

## 分页与快速打开

主 JSONL 可以作为唯一事实来源。为了前端快速打开和滚动分页，后续可以配套维护：

```text
session.jsonl
session.index.json
session.snapshot.json
```

其中：

- `session.jsonl` 是主事件日志。
- `session.index.json` 保存 `eventId`、`turnId`、`messageId` 到文件 offset 的索引。
- `session.snapshot.json` 保存最近会话状态，便于页面秒开。

## 写入与损坏处理

第一版暂不要求每个事件写入后 `fsync`。

如果前端或服务端读取时发现 JSONL 最后一行是半截坏 JSON，可以直接丢弃最后一行。完整行视为有效事实。

## 设计约束

- 事件以追加为主，已写入事件不修改、不删除。
- 顺序以 JSONL 文件行顺序为准。
- `eventId` 使用雪花 ID，负责唯一、去重、分页游标和索引查询。
- 当前版本不记录完整模型输入快照，只保留用户消息和最终助手消息作为会话记忆基础。
- `modelInput` 只作为运行时内存上下文，不写入 JSONL。
- 工具调用参数和工具结果使用独立工具事件建模，不塞进 `ASSISTANT_MESSAGE`。
- 旧 JSONL 数据不再做兼容读取或迁移，按新版事件结构重新生成。
- assistant 流式增量不逐条写入 JSONL，只通过 SSE 推给前端，并在后端内存中暂存。
- 服务硬崩溃时，尚未落盘的内存文本可以丢失，恢复逻辑基于最近一个完整 JSONL 事件继续。
