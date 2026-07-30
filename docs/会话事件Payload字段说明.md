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

字段约束：

- `eventId`：后端通过雪花 ID 生成，用于事件唯一标识和前端去重。
- `sessionId`：事件所属会话 ID。新会话的首个 SSE 事件也用于将前端本地临时会话绑定到真实会话。
- `turnId`：关联同一轮事件。当前后端生成的会话事件都在 turn 建立后产生，因此携带真实 `turnId`；前端本地构造的取消事件允许为空。
- `type`：`SessionEventType` 枚举名。事件类型与 Payload Java 类型严格绑定，写入和读取 JSONL 时都会校验类型是否匹配。
- `source`：事件来源，取值为 `USER`、`ASSISTANT` 或 `SYSTEM`。
- `createdAt`：后端事件创建时间。
- `payload`：事件主体，结构由 `type` 决定。
- `meta`：扩展元数据。当前后端事件均写入空对象；前端本地取消事件会写入 `{ "local": true }`。

## 2. 事件类型

| 事件类型 | Payload | 来源 | JSONL | 说明 |
| --- | --- | --- | --- | --- |
| `USER_MESSAGE` | `UserMessagePayload` | `USER` | 是 | 用户原始消息 |
| `ASSISTANT_MESSAGE` | `AssistantMessagePayload` | `ASSISTANT` | 是 | 助手消息终态快照 |
| `TOOL_CALL_STARTED` | `ToolCallStartedPayload` | `ASSISTANT` | 是 | 工具调用开始 |
| `TOOL_CALL_ENDED` | `ToolCallEndedPayload` | `SYSTEM` | 是 | 工具调用结束，成功或失败由 `status` 区分 |
| `TOOL_APPROVAL_REQUIRED` | `ToolApprovalRequiredPayload` | `SYSTEM` | 是 | 工具执行前等待用户授权 |
| `ERROR` | `ErrorPayload` | `SYSTEM` | 是 | 当前 turn 执行错误 |
| `CANCELLED` | `CancelledPayload` | `SYSTEM` | 是 | SSE 取消导致当前 turn 结束 |
| `ASSISTANT_MESSAGE_DELTA` | `AssistantMessageDeltaPayload` | `ASSISTANT` | 否 | 助手文本增量，仅通过 SSE 推送 |

表中的来源是当前后端生成事件时使用的值。前端为即时更新 UI 而本地构造的 `CANCELLED` 来源为 `USER`，且不会写入 JSONL。

## 3. 消息事件

### `USER_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 用户消息唯一 ID |
| `text` | `String` | 是 | 用户输入原文 |

### `ASSISTANT_MESSAGE_DELTA`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与助手终态消息及其工具事件相同的消息 ID |
| `text` | `String` | 是 | 本次新增文本，不是完整快照 |

前端按到达顺序追加同一 `messageId` 的 delta。消息进入 `complete`、`cancel` 或 `error` 后，迟到 delta 必须忽略。

### `ASSISTANT_MESSAGE`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 与增量、工具调用和工具授权事件共用的助手消息 ID |
| `state` | `String` | 是 | `complete`、`cancel` 或 `error` |
| `text` | `String` | 是 | 完整回复，或取消、错误前累计的部分回复 |
| `errorMessage` | `String` | 否 | `state=error` 时的模型错误信息 |
| `durationMs` | `Long` | 否 | 本轮耗时，单位毫秒 |

状态含义：

- `complete`：模型正常完成，`text` 是最终完整回复。
- `cancel`：SSE 被取消，`text` 是取消前已累计的非空回复。
- `error`：模型执行错误，`text` 是错误前已累计的非空回复。

状态枚举通过 `CodeEnum` 序列化为以上小写 code，不使用 Java 枚举名 `COMPLETE`、`CANCEL`、`ERROR`。

最终 `ASSISTANT_MESSAGE` 是权威快照。前端按 `messageId` 使用其 `text` 覆盖累计 delta，同时保留已经归并的工具调用信息。当前代码在取消或错误时仅当累计文本非空才写入该事件；没有累计文本时不会生成对应的助手终态快照。

## 4. 错误与取消事件

### `ERROR`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `errorMessage` | `String` | 否 | 面向展示和排查的错误信息；空白异常消息会替换为“未知错误” |
| `durationMs` | `Long` | 否 | 错误发生前耗时 |

模型执行错误且此前已有非空助手文本时，后端先写入并推送 `ASSISTANT_MESSAGE(state=error)`，再写入并推送 `ERROR`。如果错误前没有助手文本，包括助手流尚未建立或尚未输出文本的情况，则只有 `ERROR`。

### `CANCELLED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | `Long` | 否 | 取消前耗时 |

`CancelledPayload` 当前不包含 `reason`。用户停止、关闭页面或连接断开都会通过 SSE 取消传播到后端：

- 外层 turn 取消回调写入 `CANCELLED`。
- 助手流取消回调会取消模型流和该 turn 下仍在等待的工具授权。
- 仅当取消前已累计非空助手文本时，助手流才写入 `ASSISTANT_MESSAGE(state=cancel)`。
- 当前页面通过来源为 `USER`、`meta.local=true` 的本地 `CANCELLED` 事件即时更新 UI。

## 5. 工具事件

工具相关事件通过 `messageId` 归属到助手消息，通过 `toolCallId` 关联同一次工具调用。

### `TOOL_CALL_STARTED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID |
| `toolName` | `String` | 是 | 稳定工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串；文件工具使用格式化后的安全参数摘要，`edit_file` 和 `write_file` 不记录正文内容 |

不需要授权或已有会话权限时，该事件在工具执行前直接产生。需要授权时，只有用户允许后才产生；拒绝、超时或授权校验失败时可能没有对应的 `TOOL_CALL_STARTED`。

### `TOOL_APPROVAL_REQUIRED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `approvalId` | `String` | 是 | 授权请求 ID，用于调用授权处理接口 |
| `toolCallId` | `String` | 是 | 待授权的工具调用 ID |
| `toolName` | `String` | 是 | 待授权的工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串；与对应开始事件使用同一份安全参数摘要 |
| `title` | `String` | 是 | 授权卡片标题 |
| `description` | `String` | 是 | 授权卡片说明 |
| `permissionType` | `String` | 是 | 当前为 `TOOL`、`READ`、`WRITE` 或 `COMMAND`；`NONE` 不会触发授权事件 |
| `grantPath` | `String` | 否 | `READ`、`WRITE` 对应的规范化绝对授权目录；`TOOL` 时为空 |
| `approvalIndex` | `Integer` | 否 | 当前授权阶段，从 1 开始；历史缺失时按单阶段兼容 |
| `approvalCount` | `Integer` | 否 | 本次实际需要用户处理的授权阶段总数 |

历史事件缺失 `permissionType` 时，当前前端按 `TOOL` 展示以兼容旧数据。路径授权覆盖 `grantPath` 目录及其子目录。

授权请求通过以下接口处理：

```http
POST /session/{sessionId}/approvals/{approvalId}
Content-Type: application/json

{
  "decision": "ALLOW_ONCE"
}
```

`decision` 取值：

- `ALLOW_ONCE`：只允许本次工具调用，不持久化会话权限。
- `ALLOW_SESSION`：允许当前阶段，并按权限类型将工具名、只读目录、读写目录或命令精确指纹写入会话权限配置。
- `DENY`：拒绝本次调用。

待授权请求只保存在当前应用进程内，最长等待 10 分钟。`TOOL_APPROVAL_REQUIRED` 虽然会持久化，但历史中的 `approvalId` 不代表请求仍可处理；前端历史回放会将未结束的授权卡片标记为“授权请求已失效”。当前没有单独的“授权已允许/已拒绝”事件。

### `TOOL_CALL_ENDED`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `String` | 是 | 所属助手消息 ID |
| `toolCallId` | `String` | 是 | 单次工具调用 ID |
| `toolName` | `String` | 是 | 稳定工具名称 |
| `arguments` | `String` | 是 | 工具参数 JSON 字符串；文件工具使用格式化后的安全参数摘要 |
| `status` | `String` | 是 | `completed` 或 `failed` |
| `resultPreview` | `String` | 否 | 工具结果摘要；普通工具最多 2,000 字符，五个文件工具和 `run_command` 最多 4,000 字符，超限时保留头尾并插入省略字符数提示 |
| `errorCode` | `String` | 否 | 失败时优先记录真实文件工具或权限错误码；无法提取明确错误码时回退为 `TOOL_EXECUTION_FAILED` |
| `errorMessage` | `String` | 否 | 面向用户的错误说明；可与 `resultPreview` 不同 |
| `durationMs` | `Long` | 否 | 工具调用耗时，单位毫秒 |

授权被拒绝、授权超时或权限校验失败时，权限执行器会返回失败的工具结果，随后通常形成 `TOOL_CALL_ENDED(status=failed)`。该工具调用可能没有 `TOOL_CALL_STARTED`。

## 6. 典型顺序

正常完成且无需等待授权：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
ASSISTANT_MESSAGE state=complete
SSE 完成
```

工具需要授权且用户允许：

```text
USER_MESSAGE
TOOL_APPROVAL_REQUIRED
TOOL_CALL_STARTED
TOOL_CALL_ENDED
ASSISTANT_MESSAGE state=complete
```

工作区外命令需要两阶段授权：

```text
USER_MESSAGE
TOOL_APPROVAL_REQUIRED WRITE 1/2
TOOL_APPROVAL_REQUIRED COMMAND 2/2
TOOL_CALL_STARTED
TOOL_CALL_ENDED
ASSISTANT_MESSAGE state=complete
```

工具授权被拒绝、超时或校验失败：

```text
USER_MESSAGE
TOOL_APPROVAL_REQUIRED
TOOL_CALL_ENDED status=failed（通常产生，且可能没有 TOOL_CALL_STARTED）
ASSISTANT_MESSAGE state=complete / error（取决于模型后续处理）
```

模型执行错误：

```text
USER_MESSAGE
ASSISTANT_MESSAGE_DELTA（0 到多次，仅 SSE）
TOOL_APPROVAL_REQUIRED / TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
ASSISTANT_MESSAGE state=error（仅已有非空文本时）
ERROR
```

客户端取消后持久化：

```text
USER_MESSAGE
TOOL_APPROVAL_REQUIRED / TOOL_CALL_STARTED / TOOL_CALL_ENDED（0 到多次）
CANCELLED / ASSISTANT_MESSAGE state=cancel（助手事件仅已有非空文本时）
```

当前实现由外层 turn 和助手流分别处理取消，前端回放不应依赖 `CANCELLED` 与 `ASSISTANT_MESSAGE state=cancel` 的文件先后顺序。取消前已经发送的 delta 不写入 JSONL，其累计结果仅在非空时通过 `ASSISTANT_MESSAGE.text` 保存。取消终态不会再通过已经断开的原 SSE 返回。

## 7. 兼容性

- 旧 JSONL 中的 turn 生命周期事件，以及旧的助手状态 `completed`、`interrupted`，均不再兼容。
- `TOOL_APPROVAL_REQUIRED.permissionType`、`approvalIndex` 和 `approvalCount` 为后续新增字段；前端对缺失权限类型按 `TOOL`、缺失阶段字段按单阶段兼容。
- JSONL 解析依赖已知的事件类型和来源。未知枚举值会被视为格式错误。
