# Agent Session JSONL 事件日志设计

## 目标

每个 session 使用一个追加式 JSONL 文件记录用户消息、助手最终消息、工具调用、错误和取消事实，用于历史回显与聊天记忆恢复。

## 核心约束

- 一个 session 同一时间只允许一个活跃 turn。
- `turnId` 负责关联一轮中的所有事件，不使用独立的 turn 生命周期事件。
- JSONL 每行必须是完整 `SessionEvent`，已写入事件不修改、不删除。
- `ASSISTANT_MESSAGE_DELTA` 仅用于 SSE，不写入 JSONL。
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

持久化事件为除 `ASSISTANT_MESSAGE_DELTA` 外的全部事件。

## 流式消息策略

1. 创建 turn、设置数据库 `active_turn_id` 并写入 `USER_MESSAGE`。
2. 模型生成文本时，通过 SSE 推送 `ASSISTANT_MESSAGE_DELTA`，后端同时在内存中累计完整文本。
3. 工具调用事件写入 JSONL 并通过 SSE 推送。
4. 正常完成时写入并推送完整的 `ASSISTANT_MESSAGE(state=completed)`，随后清理活跃 turn 并结束 SSE。
5. 最终助手消息与所有 delta 使用同一个 `messageId`。

前端把 delta 作为临时展示；收到最终助手消息后，用最终 `text` 覆盖累计文本并保留工具展示信息。这样可以修正增量丢失、重复或客户端处理偏差。

## 错误处理

模型回调只负责向 Flux 发送 error。`TurnService.chatTurn` 使用 `onErrorResume` 统一执行：

1. 有部分文本时写入 `ASSISTANT_MESSAGE(state=interrupted)`。
2. 写入并返回一个 `ERROR`。
3. 清理 `active_turn_id` 和运行时缓存。

turn 创建前失败或错误事件自身无法写入时，由 `TurnService.chatTurn` 返回不持久化的兜底 `ERROR`。Controller 只负责把 `SessionEvent` 映射为 SSE。

## 取消处理

前端停止时直接取消 SSE，不调用额外取消接口。后端在整个 turn Flux 创建之初注册 `onCancel`：

1. 取消模型 `StreamingHandle`；句柄尚未取得时记录取消状态，取得后立即取消。
2. 有部分文本时写入 `ASSISTANT_MESSAGE(state=interrupted)`。
3. 写入 `CANCELLED(reason=sse_cancelled)`。
4. 清理 `active_turn_id` 和运行时缓存。

原 SSE 已经断开，取消事件不会再通过该连接返回；当前页面使用本地取消事件更新 UI，之后的历史回显读取后端持久化结果。

## 终态竞争

运行时状态包括 `OPEN`、`COMPLETING`、`FAILING`、`CANCELLING` 和 `CLOSED`。完成、错误和取消必须从 `OPEN` 原子取得终态处理权，确保只执行一种终态，并防止终态事件后继续写入工具事件。

## 历史恢复

1. 按文件顺序读取 JSONL，并按 `eventId` 去重。
2. 渲染 `USER_MESSAGE`。
3. 将工具事件按 `messageId` 合并到助手消息。
4. 使用 `ASSISTANT_MESSAGE` 恢复助手完整或部分文本。
5. 使用 `ERROR` 和 `CANCELLED` 恢复错误或取消提示。

服务硬崩溃时，尚未形成最终助手快照的内存文本允许丢失，恢复逻辑以最后一个完整 JSONL 事件为准。

## 文件与损坏处理

- `session.jsonl` 是事实来源，后续可以增加索引或快照文件加速读取。
- 写入前检查最后一行；如果最后一行不是完整 JSON，仅删除该损坏尾行。
- 不要求每个事件单独 `fsync`。
