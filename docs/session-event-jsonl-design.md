# Agent Session JSONL 事件日志设计

## 目标

每个 session 使用一个追加式 JSONL 文件记录用户消息、助手终态消息、工具调用、错误和取消事实，用于历史回显与聊天记忆恢复。

## 核心约束

- 一个 session 同一时间只允许一个活跃 turn，数据库字段 `active_turn_id` 用于并发占用校验。
- `turnId` 只负责关联同一轮中的事件，不使用独立的 turn 开始、完成或失败事件。
- JSONL 每行都是完整 `SessionEvent`，已写入事件不修改。
- `ASSISTANT_MESSAGE_DELTA` 只通过 SSE 推送，不写入 JSONL。
- 旧版事件数据不兼容，也不提供迁移。

## 事件集合

```java
public enum SessionEventType {
    USER_MESSAGE,
    ASSISTANT_MESSAGE,
    TOOL_CALL_STARTED,
    TOOL_CALL_ENDED,
    ERROR,
    CANCELLED,
    ASSISTANT_MESSAGE_DELTA
}
```

除 `ASSISTANT_MESSAGE_DELTA` 外，其余事件都会写入 JSONL。

## SSE 协议

`POST /session/chat` 返回 `text/event-stream`，每条 SSE 的事件名固定为 `session`，`data` 是完整的 `SessionEvent` JSON。

正常流式过程：

1. 创建或加载活跃 session，生成 `turnId` 并占用 `active_turn_id`。
2. 写入并推送 `USER_MESSAGE`。
3. 模型生成文本时推送 `ASSISTANT_MESSAGE_DELTA`，后端同时在内存中累计文本。
4. 工具执行前写入并推送 `TOOL_CALL_STARTED`，执行结束后写入并推送 `TOOL_CALL_ENDED`。
5. 模型正常结束时写入并推送 `ASSISTANT_MESSAGE(state=complete)`。
6. SSE 完成，并在 `doFinally` 中清理当前 `active_turn_id`。

所有助手 delta、工具事件和最终助手消息共用同一个 `messageId`。前端收到最终 `ASSISTANT_MESSAGE` 后，应使用其中的完整 `text` 覆盖本地累计文本，同时保留已经合并的工具调用信息。

## 错误处理

模型流回调发生错误时，当前实现按以下顺序处理：

1. 写入并推送 `ASSISTANT_MESSAGE(state=error)`；`text` 保存错误前已经累计的文本，`errorMessage` 保存模型错误信息。
2. 将错误继续传给外层 turn Flux。
3. 外层 `onErrorResume` 写入并推送 `ERROR`。
4. 最终清理 `active_turn_id`。

如果错误发生在助手流建立之前，例如写入用户事件失败，则可能只有 `ERROR`，没有 `ASSISTANT_MESSAGE`。

`startTurn()` 在返回 Flux 前同步执行。会话不存在、会话不可继续使用或已有运行中 turn 等错误，由全局异常处理器返回统一 `R` JSON，不会包装成 SSE 事件。

## 取消处理

前端停止生成时直接取消 SSE 请求，不调用单独的取消接口。取消传播到后端后：

1. 取消当前模型 `StreamingHandle`。
2. 外层 turn 取消回调写入 `CANCELLED`。
3. 助手流取消回调写入 `ASSISTANT_MESSAGE(state=cancel)`，保存取消前已经累计的文本。
4. 清理 `active_turn_id`。

取消发生时原 SSE 已经断开，因此这两个终态事件只写入 JSONL，不再通过原连接返回。前端回放不应依赖两条取消终态事件的文件先后顺序。当前页面使用本地构造的 `CANCELLED` 事件即时更新 UI，重新打开会话时再以后端 JSONL 为准。

当前实现尚未使用 CAS 统一竞争完成、错误和取消终态；极端并发时的终态竞争仍属于后续完善项。

## 历史恢复

1. 按文件顺序读取 JSONL，并按 `eventId` 去重。
2. 渲染 `USER_MESSAGE`。
3. 将 `TOOL_CALL_STARTED` 和 `TOOL_CALL_ENDED` 按 `messageId`、`toolCallId` 合并到助手消息。
4. 使用 `ASSISTANT_MESSAGE` 恢复 `complete`、`cancel` 或 `error` 状态及其完整或部分文本。
5. 使用 `ERROR` 和 `CANCELLED` 恢复系统错误或取消提示。

服务硬崩溃时，尚未形成 `ASSISTANT_MESSAGE` 快照的内存文本允许丢失，恢复逻辑以最后一个完整 JSONL 事件为准。

## 文件与损坏处理

- 新会话的相对路径为 `sessions/{sessionId}/session.jsonl`，最终相对于应用数据目录解析。
- 写入前检查最后一行；如果最后一行不是合法事件 JSON，仅移除该损坏尾行。
- 读取时忽略空行；中间行损坏会使本次读取失败，最后一行损坏则暂时忽略。
- 当前不要求每个事件单独 `fsync`。
