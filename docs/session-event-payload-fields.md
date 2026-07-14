# Session Event Payload 字段说明

## 1. 文档范围

本文档说明 `SessionEvent.payload` 在不同会话事件类型下的 JSON 结构，供后端事件写入、SSE 推送、前端解析和问题排查使用。

事件使用统一信封，`payload` 的具体类型由 `type` 决定：

```json
{
  "eventId": "事件 ID",
  "sessionId": "会话 ID",
  "turnId": "轮次 ID",
  "type": "事件类型",
  "source": "事件来源",
  "createdAt": "UTC ISO-8601 时间",
  "payload": {},
  "meta": {}
}
```

约定：

- `payload` 本身不能为空，并且必须与事件 `type` 对应。
- “必填”表示正常生产和消费该事件时必须提供。当前后端只校验 payload 类型，没有逐字段进行非空校验。
- `String` 对应 JSON 字符串，`Long` 对应 JSON 数字，`Boolean` 对应 JSON 布尔值。
- 可选字段在当前序列化配置下可能表现为 `null`，消费端应同时兼容字段缺失和字段值为 `null`。
- `durationMs` 统一表示耗时，单位为毫秒。
- 除 `ASSISTANT_MESSAGE_DELTA` 外，本文档中的事件都会写入 Session JSONL，并通过 SSE 推送给前端。

## 2. 事件与 Payload 类型映射

| 事件类型 | Payload 类型 | 是否写入 JSONL | 说明 |
| --- | --- | --- | --- |
| `TURN_STARTED` | `TurnStartedPayload` | 是 | 一轮会话开始 |
| `TURN_COMPLETED` | `TurnCompletedPayload` | 是 | 一轮会话正常完成 |
| `TURN_FAILED` | `TurnFailedPayload` | 是 | 一轮会话执行失败 |
| `TURN_CANCELLED` | `TurnCancelledPayload` | 是 | 一轮会话被取消 |
| `TURN_SUPERSEDED` | `TurnSupersededPayload` | 是 | 旧轮次被新轮次替换 |
| `USER_MESSAGE` | `UserMessagePayload` | 是 | 用户消息 |
| `ASSISTANT_MESSAGE` | `AssistantMessagePayload` | 是 | 助手消息的最终状态和完整或部分文本 |
| `TOOL_CALL_STARTED` | `ToolCallStartedPayload` | 是 | 工具调用开始 |
| `TOOL_CALL_COMPLETED` | `ToolCallCompletedPayload` | 是 | 工具调用成功完成 |
| `TOOL_CALL_FAILED` | `ToolCallFailedPayload` | 是 | 工具调用失败 |
| `ASSISTANT_MESSAGE_DELTA` | `AssistantMessageDeltaPayload` | 否 | 助手流式文本增量，仅运行时推送 |

## 3. Turn 事件

### 3.1 `TURN_STARTED`

表示新的 turn 已创建并开始执行。

| 字段 | 类型 | 必填 | 说明 | 当前值或示例 |
| --- | --- | --- | --- | --- |
| `trigger` | `String` | 是 | 本轮的触发方式 | 当前为 `user`；协议预留 `retry`、`resume`、`edit_resend` |
| `userMessageId` | `String` | 是 | 本轮用户消息 ID，与随后 `USER_MESSAGE.payload.messageId` 一致 | 雪花 ID 字符串 |

示例：

```json
{
  "trigger": "user",
  "userMessageId": "1934500000000000001"
}
```

### 3.2 `TURN_COMPLETED`

表示 turn 已正常完成。该事件通常出现在终态为 `completed` 的 `ASSISTANT_MESSAGE` 之后。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | `Long` | 否 | 从本轮执行开始到完成的总耗时，单位毫秒；当前正常完成流程会提供 |

示例：

```json
{
  "durationMs": 1826
}
```

### 3.3 `TURN_FAILED`

表示 turn 因模型调用、流处理或其他执行异常而失败。

| 字段 | 类型 | 必填 | 说明 | 当前生成规则 |
| --- | --- | --- | --- | --- |
| `errorCode` | `String` | 否 | 错误编码，供程序识别和分类 | turn 执行失败时通常为异常类名 |
| `errorMessage` | `String` | 否 | 面向排查或展示的错误摘要 | 异常没有消息时可能为空字符串或兜底文案 |
| `durationMs` | `Long` | 否 | 失败前已经执行的耗时，单位毫秒 | 流式执行失败时提供；请求建立阶段失败时可能为空 |

示例：

```json
{
  "errorCode": "RuntimeException",
  "errorMessage": "模型服务调用失败",
  "durationMs": 932
}
```

### 3.4 `TURN_CANCELLED`

表示 turn 被用户、客户端连接状态或系统逻辑取消。该事件通常与 `state=interrupted` 的 `ASSISTANT_MESSAGE` 配套出现。

| 字段 | 类型 | 必填 | 说明 | 示例值 |
| --- | --- | --- | --- | --- |
| `reason` | `String` | 否 | 取消原因 | `user_cancelled`、`client_disconnected` |
| `durationMs` | `Long` | 否 | 取消前已经执行的耗时，单位毫秒 | `1250` |

示例：

```json
{
  "reason": "user_cancelled",
  "durationMs": 1250
}
```

### 3.5 `TURN_SUPERSEDED`

表示当前旧 turn 已被另一个新 turn 替换。该结构已经进入事件协议，但当前项目中尚未发现实际写入逻辑。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `supersededByTurnId` | `String` | 否 | 替换当前旧 turn 的新 turn ID |
| `reason` | `String` | 否 | 替换原因，例如编辑后重发、失败后重试 |
| `hiddenInNormalView` | `Boolean` | 否 | 是否在普通聊天视图隐藏旧 turn；审计或完整回放仍可保留 |

示例：

```json
{
  "supersededByTurnId": "1934500000000000102",
  "reason": "edit_resend",
  "hiddenInNormalView": true
}
```

## 4. 消息事件

### 4.1 `USER_MESSAGE`

记录用户在当前 turn 中发送的原始消息。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 用户消息唯一 ID，与 `TURN_STARTED.payload.userMessageId` 一致 |
| `text` | `String` | 是 | 用户输入的原始文本 |

示例：

```json
{
  "messageId": "1934500000000000001",
  "text": "请分析当前项目结构"
}
```

### 4.2 `ASSISTANT_MESSAGE_DELTA`

助手流式输出的单个文本增量。该事件只通过 SSE 在运行时推送，不写入 JSONL。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 助手消息 ID；同一条回复的所有增量和最终消息使用同一个 ID |
| `text` | `String` | 是 | 本次新增的文本片段，不是截至当前的完整文本 |

示例：

```json
{
  "messageId": "1934500000000000002",
  "text": "我先查看"
}
```

消费端应按接收顺序将相同 `messageId` 的 `text` 追加到现有内容中。最终以 `ASSISTANT_MESSAGE` 的 `text` 为准。

### 4.3 `ASSISTANT_MESSAGE`

记录助手消息的终态。正常完成时保存完整文本；失败或取消时保存已经产生的部分文本。

| 字段 | 类型 | 必填 | 适用状态 | 说明 |
| --- | --- | --- | --- | --- |
| `messageId` | `String` | 是 | 全部 | 助手消息唯一 ID，与对应增量和工具事件中的 `messageId` 一致 |
| `state` | `String` | 是 | 全部 | 消息状态，只允许 `completed` 或 `interrupted` |
| `text` | `String` | 是 | 全部 | `completed` 时为完整回复；`interrupted` 时为中断前已经生成的部分回复，可为空字符串 |
| `finishReason` | `String` | 条件必填 | `completed` | 正常结束原因；当前固定为 `stop` |
| `reason` | `String` | 条件必填 | `interrupted` | 中断原因，例如 `model_error`、`user_cancelled`、`client_disconnected` |
| `errorMessage` | `String` | 否 | `interrupted` | 中断由错误引起时的错误摘要；主动取消时通常为空 |
| `durationMs` | `Long` | 否 | 全部 | 本轮执行耗时，单位毫秒；当前终态流程会提供 |

正常完成示例：

```json
{
  "messageId": "1934500000000000002",
  "state": "completed",
  "text": "项目结构分析完成。",
  "finishReason": "stop",
  "reason": null,
  "errorMessage": null,
  "durationMs": 1826
}
```

异常中断示例：

```json
{
  "messageId": "1934500000000000002",
  "state": "interrupted",
  "text": "已经完成的部分内容",
  "finishReason": null,
  "reason": "model_error",
  "errorMessage": "模型服务连接中断",
  "durationMs": 932
}
```

## 5. 工具调用事件

工具调用的开始、完成和失败事件通过 `toolCallId` 关联，通过 `messageId` 归属到产生该工具调用的助手消息。

### 5.1 公共字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 发起工具调用的助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID，用于关联开始事件与终态事件 |
| `toolName` | `String` | 是 | 稳定的工具名称，前端可据此决定展示文案和图标 |
| `arguments` | `String` | 是 | 工具调用参数的 JSON 字符串；字段本身不是 JSON 对象，消费端需要展示结构时应再次解析 |

### 5.2 `TOOL_CALL_STARTED`

表示工具即将开始执行，只包含公共字段。

示例：

```json
{
  "messageId": "1934500000000000002",
  "toolCallId": "call_7f8a",
  "toolName": "getWeather",
  "arguments": "{\"city\":\"杭州\"}"
}
```

### 5.3 `TOOL_CALL_COMPLETED`

表示工具成功执行完成。

除公共字段外，还包含：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resultPreview` | `String` | 否 | 工具结果摘要，用于前端展示；不保证包含完整工具返回值 |
| `errorCode` | `String` | 否 | 错误编码；成功时为空 |
| `errorMessage` | `String` | 否 | 错误信息；成功时为空 |
| `durationMs` | `Long` | 否 | 工具执行耗时，单位毫秒；当前执行流程会提供 |

示例：

```json
{
  "messageId": "1934500000000000002",
  "toolCallId": "call_7f8a",
  "toolName": "getWeather",
  "arguments": "{\"city\":\"杭州\"}",
  "resultPreview": "杭州当前天气：晴，28℃",
  "errorCode": null,
  "errorMessage": null,
  "durationMs": 316
}
```

### 5.4 `TOOL_CALL_FAILED`

表示工具执行失败。

除公共字段外，还包含：

| 字段 | 类型 | 必填 | 说明 | 当前生成规则 |
| --- | --- | --- | --- | --- |
| `resultPreview` | `String` | 否 | 工具失败结果或返回内容的摘要 | 当前会保留工具执行结果摘要 |
| `errorCode` | `String` | 否 | 稳定错误编码 | 当前固定为 `TOOL_EXECUTION_FAILED` |
| `errorMessage` | `String` | 否 | 错误摘要 | 当前与 `resultPreview` 相同 |
| `durationMs` | `Long` | 否 | 工具执行到失败的耗时，单位毫秒 | 当前执行流程会提供 |

示例：

```json
{
  "messageId": "1934500000000000002",
  "toolCallId": "call_7f8a",
  "toolName": "getWeather",
  "arguments": "{\"city\":\"杭州\"}",
  "resultPreview": "天气服务请求超时",
  "errorCode": "TOOL_EXECUTION_FAILED",
  "errorMessage": "天气服务请求超时",
  "durationMs": 3001
}
```

## 6. 字段关联关系

| 关联字段 | 关系说明 |
| --- | --- |
| `TURN_STARTED.userMessageId` → `USER_MESSAGE.messageId` | 标识当前 turn 对应的用户消息 |
| `ASSISTANT_MESSAGE_DELTA.messageId` → `ASSISTANT_MESSAGE.messageId` | 将流式增量归并到最终助手消息 |
| 工具事件 `messageId` → `ASSISTANT_MESSAGE.messageId` | 表示工具调用属于哪一条助手消息 |
| `TOOL_CALL_STARTED.toolCallId` → 工具终态事件 `toolCallId` | 关联同一次工具调用的开始和完成或失败事件 |
| `TURN_SUPERSEDED.supersededByTurnId` → 新事件信封 `turnId` | 定位替换旧 turn 的新 turn |

典型正常事件顺序：

```text
TURN_STARTED
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_CALL_STARTED（0 到多次）
TOOL_CALL_COMPLETED 或 TOOL_CALL_FAILED（与开始事件配对）
ASSISTANT_MESSAGE state=completed
TURN_COMPLETED
```

典型异常事件顺序：

```text
TURN_STARTED
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
ASSISTANT_MESSAGE state=interrupted
TURN_FAILED 或 TURN_CANCELLED
```

## 7. 消费端处理建议

- 必须先根据事件 `type` 选择对应 payload 结构，不应把所有 payload 字段合并为一个固定对象处理。
- 未识别的可选字段应忽略，以便后续协议扩展。
- `arguments` 应先按普通字符串接收；只有在需要格式化展示或读取参数时再按 JSON 解析，并处理解析失败。
- `resultPreview` 只是摘要，不应用作完整工具结果或可靠的业务数据源。
- 收到 `ASSISTANT_MESSAGE` 后，应使用其中的 `text` 覆盖或校正前端累计的增量文本。
- 恢复历史时不应等待 `ASSISTANT_MESSAGE_DELTA`，因为该事件不会写入 JSONL。
- 同一 turn 的终态应以 `TURN_COMPLETED`、`TURN_FAILED` 或 `TURN_CANCELLED` 判断；助手消息终态由 `ASSISTANT_MESSAGE.state` 判断。

## 8. 代码来源

本文档以以下实现为准：

- 后端 payload：`src/main/java/com/yu/mboocode/session/payload`
- 事件与 payload 映射：`src/main/java/com/yu/mboocode/session/enums/SessionEventType.java`
- 事件信封：`src/main/java/com/yu/mboocode/session/model/SessionEvent.java`
- 当前事件生产逻辑：`src/main/java/com/yu/mboocode/session/service/TurnService.java`
- 前端类型：`mboo-web/src/lib/session-types.ts`
