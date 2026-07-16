# Session Event Payload 字段说明

## 1. 统一事件信封

`SessionEvent` 同时用于 JSONL 持久化、SSE 推送和前端历史回放：

```json
{
  "eventId": "事件 ID",
  "sessionId": "会话 ID",
  "turnId": "轮次 ID",
  "type": "事件类型",
  "source": "USER、ASSISTANT 或 SYSTEM",
  "createdAt": "UTC ISO-8601 时间",
  "payload": {},
  "meta": {}
}
```

`turnId` 用于关联同一轮事件。当前持久化事件都在 turn 建立后产生，因此携带真实 `turnId`；前端本地构造的取消事件允许为空。

## 2. 事件类型

| 事件类型 | Payload | JSONL | 说明 |
| --- | --- | --- | --- |
| `USER_MESSAGE` | `UserMessagePayload` | 是 | 用户原始消息 |
| `ASSISTANT_MESSAGE` | `AssistantMessagePayload` | 是 | 助手消息终态快照 |
| `ASSISTANT_MESSAGE_DELTA` | `AssistantMessageDeltaPayload` | 否 | 助手文本增量，仅通过 SSE 推送 |
| `TOOL_CALL_STARTED` | `ToolCallStartedPayload` | 是 | 工具调用开始 |
| `TOOL_CALL_ENDED` | `ToolCallEndedPayload` | 是 | 工具调用结束，成功或失败由 `status` 区分 |
| `ERROR` | `ErrorPayload` | 是 | 当前 turn 执行错误 |
| `CANCELLED` | `CancelledPayload` | 是 | SSE 取消导致当前 turn 结束 |

## 3. 消息事件

### `USER_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 用户消息唯一 ID |
| `text` | `String` | 是 | 用户输入原文 |

### `ASSISTANT_MESSAGE_DELTA`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与助手终态消息相同的消息 ID |
| `text` | `String` | 是 | 本次新增文本，不是完整快照 |

前端按到达顺序追加同一 `messageId` 的 delta。消息进入 `complete`、`cancel` 或 `error` 后，迟到 delta 必须忽略。

### `ASSISTANT_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与增量和工具事件共用的助手消息 ID |
| `state` | `String` | 是 | `complete`、`cancel` 或 `error` |
| `text` | `String` | 是 | 完整回复，或取消、错误前累计的部分回复 |
| `errorMessage` | `String` | 否 | `state=error` 时的模型错误信息 |
| `durationMs` | `Long` | 否 | 本轮耗时，单位毫秒 |

状态含义：

- `complete`：模型正常完成，`text` 是最终完整回复。
- `cancel`：SSE 被取消，`text` 是取消前已累计的回复，可以为空。
- `error`：模型执行错误，`text` 是错误前已累计的回复，可以为空。

状态枚举通过 `CodeEnum` 序列化为以上小写 code，不使用 Java 枚举名 `COMPLETE`、`CANCEL`、`ERROR`。

最终 `ASSISTANT_MESSAGE` 是权威快照。前端必须按 `messageId` 用其 `text` 覆盖累计 delta，同时保留已经归并的工具调用信息。

## 4. 错误与取消事件

### `ERROR`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `errorMessage` | `String` | 否 | 面向展示和排查的错误信息 |
| `durationMs` | `Long` | 否 | 错误发生前耗时 |

模型执行错误时，后端通常先写入 `ASSISTANT_MESSAGE(state=error)`，再写入并通过 SSE 返回 `ERROR`。如果错误发生在助手流建立前，则可能只有 `ERROR`。

### `CANCELLED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | `Long` | 否 | 取消前耗时 |

`CancelledPayload` 当前不包含 `reason`。用户停止、关闭页面或连接断开都通过 SSE 取消传播到后端；后端写入 `ASSISTANT_MESSAGE(state=cancel)` 和 `CANCELLED`，当前页面通过本地取消事件即时更新 UI。

## 5. 工具事件

工具事件通过 `messageId` 归属到助手消息，通过 `toolCallId` 关联开始和结束事件。

### `TOOL_CALL_STARTED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID |
| `toolName` | `String` | 是 | 稳定工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串 |

### `TOOL_CALL_ENDED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID |
| `toolName` | `String` | 是 | 稳定工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串 |
| `status` | `String` | 是 | `completed` 或 `failed` |
| `resultPreview` | `String` | 否 | 最多 2000 个字符的工具结果摘要 |
| `errorCode` | `String` | 否 | 失败时当前固定为 `TOOL_EXECUTION_FAILED` |
| `errorMessage` | `String` | 否 | 失败时的错误摘要 |
| `durationMs` | `Long` | 否 | 工具调用耗时，单位毫秒 |

`TOOL_CALL_STARTED` 的事件来源当前为 `ASSISTANT`，`TOOL_CALL_ENDED` 的事件来源当前为 `SYSTEM`。

## 6. 典型顺序

正常完成：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
ASSISTANT_MESSAGE state=complete
SSE 完成
```

模型执行错误：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
ASSISTANT_MESSAGE state=error
ERROR
```

客户端取消后持久化：

```text
USER_MESSAGE
TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
CANCELLED / ASSISTANT_MESSAGE state=cancel
```

当前实现由外层 turn 和助手流分别处理取消，前端回放不应依赖 `CANCELLED` 与 `ASSISTANT_MESSAGE state=cancel` 的文件先后顺序。取消前已经发送的 delta 不写入 JSONL，其累计结果以 `ASSISTANT_MESSAGE.text` 保存。取消终态不会再通过已经断开的原 SSE 返回。

## 7. 兼容性

旧 JSONL 中的 turn 生命周期事件，以及旧的助手状态 `completed`、`interrupted`，均不再兼容。使用当前协议前需要自行清理旧会话数据。
