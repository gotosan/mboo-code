# Agent Session JSONL 事件日志设计

## 目标

每个 agent session 的对话和执行过程保存为一个 JSONL 文件。JSONL 中每一行都是一个事件，用于同时支撑：

- 前端恢复会话历史。
- 前端展示 agent 的计划、进度、工具调用、失败重试过程。
- 审计回放 agent 当时的执行过程。
- 服务重启后从中断点继续执行。
- 作为后续 agent 构建聊天记忆和模型上下文的事实来源。

## 核心概念

### Session

一次完整会话。一个 session 对应一个主 JSONL 文件。

当前约束：

- 一个 session 内不允许并发 turn。
- 同一时间最多只有一个 running turn。
- JSONL 按追加写入。
- 普通聊天历史可以隐藏被替换的 turn，但审计回放必须保留所有事件。

### Turn

一次用户请求以及 agent 随后的工作。

一个 turn 内可以包含：

- 用户消息。
- 一个或多个 assistant message。
- 一个或多个 model call。
- 工具调用与工具结果。
- agent 展示给前端的计划、进度、决策摘要。
- 错误、取消、替换、完成事件。

### Event

JSONL 中的一行。事件记录 session 的事实，例如：

- 用户消息完成。
- assistant message 开始。
- 文本增量。
- 模型调用开始和完成。
- 工具调用开始和完成。
- 工具调用恢复状态未知。
- 上下文压缩摘要创建。
- turn 完成、失败、取消、被替换。

事件一旦写入，默认不修改、不删除。用户编辑重发时，通过追加替换事件表达，不物理删除旧事件。

## 事件信封

每一行 JSONL 使用统一事件信封：

```java
public class SessionEvent {
    private int schemaVersion;

    private String eventId;
    private String sessionId;
    private String turnId;

    private long seq;

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
| `schemaVersion` | 事件结构版本，用于后续兼容升级。 |
| `eventId` | 事件唯一标识，只负责唯一和去重，不负责排序。 |
| `sessionId` | 当前 session 标识。 |
| `turnId` | 当前 turn 标识。session 级事件可以为空或使用固定值。 |
| `seq` | session 内递增序号，用于回放校验、排错、索引修复。真实回放顺序仍以文件行顺序为准。 |
| `type` | 事件类型。 |
| `source` | 事件来源，例如 `USER`、`ASSISTANT`、`MODEL`、`TOOL`、`SYSTEM`。 |
| `createdAt` | 事件创建时间。 |
| `payload` | 事件主体，根据 `type` 反序列化为具体 payload。 |
| `meta` | 扩展字段，用于调试信息、兼容信息或临时实验字段。 |

## 事件类型

第一版建议保留以下事件类型：

```java
public enum EventType {
    SESSION_CREATED,

    TURN_STARTED,
    TURN_COMPLETED,
    TURN_FAILED,
    TURN_CANCELLED,
    TURN_SUPERSEDED,

    USER_MESSAGE_COMPLETED,

    ASSISTANT_MESSAGE_STARTED,
    ASSISTANT_TEXT_DELTA,
    ASSISTANT_MESSAGE_COMPLETED,

    AGENT_PROGRESS_RECORDED,

    MODEL_CALL_STARTED,
    MODEL_CALL_COMPLETED,
    MODEL_CALL_FAILED,

    TOOL_CALL_STARTED,
    TOOL_CALL_COMPLETED,
    TOOL_CALL_UNKNOWN,

    CONTEXT_SNAPSHOT_CREATED,
    SUMMARY_CREATED,

    CHECKPOINT_CREATED
}
```

## 关键事件 Payload

### Turn 开始

```java
public class TurnStartedPayload {
    private int turnIndex;
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

`reason` 示例：

- `user_edit`
- `model_error`
- `user_cancelled`

普通聊天视图过滤 `hiddenInNormalView = true` 的旧 turn。审计回放展示全部事件。

### 用户消息完成

```java
public class UserMessageCompletedPayload {
    private String messageId;
    private String text;
    private List<AttachmentRef> attachments;
}
```

### Assistant Message 开始

```java
public class AssistantMessageStartedPayload {
    private String messageId;
}
```

### Assistant 文本增量

```java
public class AssistantTextDeltaPayload {
    private String messageId;
    private String modelCallId;
    private String delta;
}
```

允许同一个 assistant message 由多次 model call 继续追加文本。服务重启时，如果 assistant 文本已经有 delta 但还没有 completed 事件，前端保留未完成文本，agent 可以基于这些文本继续写入同一个 message。

### Assistant Message 完成

```java
public class AssistantMessageCompletedPayload {
    private String messageId;
    private String finalText;
    private String finishReason;
}
```

`ASSISTANT_TEXT_DELTA` 用于流式展示，`ASSISTANT_MESSAGE_COMPLETED` 保存最终快照，便于前端稳定恢复。

### Agent 进度记录

用于展示 agent 的计划、进度、决策摘要。它不是模型隐式思维链，而是可展示、可审计的执行摘要。

```java
public class AgentProgressRecordedPayload {
    private String title;
    private String content;
    private boolean collapsedByDefault;
}
```

### 模型调用开始

```java
public class ModelCallStartedPayload {
    private String modelCallId;
    private String parentModelCallId;

    private JsonNode inputSnapshot;

    private String model;
    private JsonNode modelParams;
}
```

`inputSnapshot` 是本次实际发送给模型的完整输入快照。它通常包括：

- system / developer prompt。
- 用户消息。
- 最近几轮对话。
- 历史压缩摘要。
- 工具调用历史。
- 可用工具 schema。
- 项目路径、当前文件、用户偏好、环境变量等额外上下文。
- 模型参数。
- 附件或文件引用。

保存 `inputSnapshot` 的目的是支持审计回放。只看聊天历史，无法判断模型当时为什么生成某个输出；真正影响输出的是最终组装后的模型输入。

### 模型调用完成

```java
public class ModelCallCompletedPayload {
    private String modelCallId;
    private JsonNode output;
    private Usage usage;
    private Long durationMs;
}
```

### 模型调用失败

```java
public class ModelCallFailedPayload {
    private String modelCallId;
    private String errorCode;
    private String errorMessage;
    private boolean retryable;
    private Long durationMs;
}
```

### 工具调用开始

```java
public class ToolCallStartedPayload {
    private String toolCallId;
    private String modelCallId;
    private String toolName;
    private JsonNode arguments;
    private int attempt;
}
```

工具可能有副作用。恢复时如果发现工具已经 started 但没有 completed，不自动重试，而是标记为 unknown，交给 agent 基于上下文判断。

### 工具调用完成

```java
public class ToolCallCompletedPayload {
    private String toolCallId;
    private boolean success;

    private JsonNode resultForModel;

    private String stdoutForModel;
    private String errorMessage;
    private Long durationMs;
}
```

`resultForModel` 和 `stdoutForModel` 记录实际传给模型的内容。如果工具原始输出太长，先做字符串截断，再把截断后的内容写入 JSONL 并传给模型。

文件、图片、二进制内容等不直接写入 JSONL，使用引用。

### 工具调用状态未知

```java
public class ToolCallUnknownPayload {
    private String toolCallId;
    private String reason;
    private String recoveryHint;
}
```

示例：

```text
reason = started_but_no_result_after_recovery
recoveryHint = 该工具调用可能已经执行过，但没有结果事件。请判断是继续、重试、标记失败还是询问用户。
```

### 上下文快照

```java
public class ContextSnapshotCreatedPayload {
    private String contextId;
    private JsonNode modelInputSnapshot;
    private List<String> summaryIds;
    private List<String> recentMessageIds;
}
```

用于记录某次上下文构建结果。上下文来源包括最近几轮对话、历史摘要和额外信息。

### 历史摘要

上下文压缩时生成历史摘要。摘要多版本追加，不修改旧摘要。

```java
public class SummaryCreatedPayload {
    private String summaryId;
    private String content;
    private String supersedesSummaryId;
}
```

后续模型输入可以引用最新摘要。

### Checkpoint

用于前端快速打开最近状态，不替代主事件日志。

```java
public class CheckpointCreatedPayload {
    private long upToSeq;
    private JsonNode conversationSnapshot;
    private JsonNode latestSummarySnapshot;
    private JsonNode runningTurnSnapshot;
}
```

## 恢复规则

### 普通聊天历史恢复

1. 读取 checkpoint 或 snapshot，得到最近状态。
2. 从 checkpoint 的 `upToSeq` 之后继续 replay JSONL。
3. 按文件行顺序应用事件。
4. 使用 `eventId` 去重。
5. 使用 `seq` 检查是否有丢行、重复或索引损坏。
6. 过滤被 `TURN_SUPERSEDED` 且 `hiddenInNormalView = true` 的旧 turn。
7. 渲染用户消息、assistant message、agent 进度、工具调用过程。

### 审计回放

1. 从 JSONL 起点或指定 checkpoint 开始读取。
2. 展示所有事件，包括被替换、被隐藏、失败、取消的 turn。
3. 按文件行顺序回放。
4. 根据事件时间和 duration 展示执行节奏；第一版可以只按顺序瞬时回放。

### 服务重启后继续执行

1. 读取最新 session JSONL。
2. 定位最后一个未完成 turn。
3. 找到最后一个成功的 `TOOL_CALL_COMPLETED`。
4. 检查是否存在 `TOOL_CALL_STARTED` 但没有对应 `TOOL_CALL_COMPLETED` 的工具调用。
5. 对这些工具调用追加 `TOOL_CALL_UNKNOWN`。
6. 保留未完成 assistant text delta。
7. 构建恢复用 model input，让 agent 判断继续、重试、失败或询问用户。

恢复时不自动重试状态未知的工具调用，因为工具可能有副作用。

## 分页与快速打开

主 JSONL 可以作为唯一事实来源，但为了前端快速打开和滚动分页，建议后续配套维护：

```text
session.jsonl
session.index.json
session.snapshot.json
```

其中：

- `session.jsonl` 是主事件日志。
- `session.index.json` 保存 `eventId`、`turnId`、`messageId` 到文件 offset 的索引，便于分页。
- `session.snapshot.json` 保存最近会话状态，便于页面秒开。

如果第一版只做 JSONL，也可以先通过 `CHECKPOINT_CREATED` 事件保存快照。但历史分页最终仍建议有 offset 索引，否则长 session 需要反复从头扫描。

## 写入与损坏处理

第一版暂不要求每个事件写入后 `fsync`。

如果前端或服务端读取时发现 JSONL 最后一行是半截坏 JSON，可以直接丢弃最后一行。完整行视为有效事实。

## 设计约束

- 事件以追加为主，已写入事件不修改、不删除。
- 顺序以 JSONL 文件行顺序为准。
- `eventId` 负责唯一和去重。
- `seq` 负责回放校验、排错和索引修复。
- 用户编辑重发创建新 turn 和新 message，不复用旧 `messageId`。
- 旧 turn 通过 `TURN_SUPERSEDED` 隐藏，普通聊天视图不可见，审计视图可见。
- 模型输入快照记录实际传给模型的内容。
- 工具输出记录实际传给模型的截断版本。
- 有副作用工具在恢复时不自动重试。
- assistant 未完成文本保留，后续可继续追加。

