# Session Event Payload 字段说明

## 1. 统一事件信封

`SessionEvent` 用于后端 JSONL 持久化、SSE 推送和前端回放：

```json
{
  "eventId": "事件 ID",
  "sessionId": "会话 ID",
  "turnId": "轮次 ID",
  "type": "事件类型",
  "source": "USER、ASSISTANT 或 SYSTEM",
  "createdAt": "ISO-8601 时间",
  "payload": {},
  "meta": {}
}
```

`turnId` 仅用于关联同一轮事件，不再使用独立的 turn 开始或结束事件。持久化的会话事件应携带真实 `turnId`；turn 创建前产生的 SSE 兜底错误和前端本地取消事件允许为空。

## 2. 事件类型

| 事件类型 | Payload | JSONL | 说明 |
| --- | --- | --- | --- |
| `USER_MESSAGE` | `UserMessagePayload` | 是 | 用户原始消息 |
| `ASSISTANT_MESSAGE` | `AssistantMessagePayload` | 是 | 助手消息最终快照 |
| `ASSISTANT_MESSAGE_DELTA` | `AssistantMessageDeltaPayload` | 否 | 助手文本增量，仅通过 SSE 推送 |
| `TOOL_CALL_STARTED` | `ToolCallStartedPayload` | 是 | 工具调用开始 |
| `TOOL_CALL_ENDED` | `ToolCallEndedPayload` | 是 | 工具调用结束，成功或失败由 payload.status 区分 |
| `ERROR` | `ErrorPayload` | 是 | 当前 turn 执行失败 |
| `CANCELLED` | `CancelledPayload` | 是 | SSE 断开导致当前 turn 取消 |

## 3. 消息事件

### `USER_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 用户消息唯一 ID |
| `text` | `String` | 是 | 用户输入原文 |

### `ASSISTANT_MESSAGE_DELTA`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与最终助手消息相同的消息 ID |
| `text` | `String` | 是 | 本次新增文本，不是完整快照 |

前端按到达顺序临时追加同一 `messageId` 的 delta。消息进入 `completed` 或 `interrupted` 后，迟到 delta 必须忽略。

### `ASSISTANT_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与增量和工具事件共用的助手消息 ID |
| `state` | `String` | 是 | `completed` 或 `interrupted` |
| `text` | `String` | 是 | 完整回复或中断前的部分回复 |
| `finishReason` | `String` | 否 | 正常完成原因，当前为 `stop` |
| `reason` | `String` | 否 | 中断原因，例如 `model_error`、`sse_cancelled` |
| `errorMessage` | `String` | 否 | 错误导致中断时的错误摘要 |
| `durationMs` | `Long` | 否 | 本轮耗时，单位毫秒 |

最终 `ASSISTANT_MESSAGE` 是权威快照。前端必须按 `messageId` 用其 `text` 覆盖累计的 delta 文本，同时保留已经归并的工具调用展示信息。没有收到 delta 时，前端直接插入最终消息。

## 4. 错误与取消事件

### `ERROR`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `errorCode` | `String` | 否 | 错误编码，当前通常为异常类名 |
| `errorMessage` | `String` | 否 | 面向展示和排查的错误摘要 |
| `durationMs` | `Long` | 否 | 错误发生前耗时 |

模型执行错误时，如果已经产生部分文本，后端先持久化 `ASSISTANT_MESSAGE(state=interrupted)`，再持久化并通过 SSE 返回一个 `ERROR`。turn 创建前或错误事件无法持久化时，`TurnService.chatTurn` 返回不持久化的兜底 `ERROR`。

### `CANCELLED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `reason` | `String` | 否 | 取消原因，后端当前为 `sse_cancelled` |
| `durationMs` | `Long` | 否 | 取消前耗时 |

用户停止、关闭页面或连接断开都通过 SSE 取消传播到后端。后端有部分文本时先保存 interrupted 的助手快照，再保存 `CANCELLED`。因为原 SSE 已断开，当前页面使用本地 `CANCELLED` 事件立即更新 UI，历史回放以后端事件为准。

## 5. 工具事件

工具事件通过 `messageId` 归属到助手消息，通过 `toolCallId` 关联开始和终态。

公共字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID |
| `toolName` | `String` | 是 | 稳定工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串 |

结束事件 `TOOL_CALL_ENDED` 还包含 `status`，以及可选的 `resultPreview`、`errorCode`、`errorMessage` 和 `durationMs`。`status` 取值 `completed` 或 `failed`；`resultPreview` 只用于展示，不是完整工具结果。

## 6. 典型顺序

正常完成：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
ASSISTANT_MESSAGE state=completed
SSE 完成
```

执行错误：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
ASSISTANT_MESSAGE state=interrupted（存在部分文本时）
ERROR
```

客户端取消：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
ASSISTANT_MESSAGE state=interrupted（存在部分文本时）
CANCELLED（仅后端持久化；当前 SSE 已断开）
```

## 7. 兼容性

旧 JSONL 中的 turn 生命周期事件不再兼容，也不提供迁移逻辑。使用新版协议前需要自行清理旧会话数据。
