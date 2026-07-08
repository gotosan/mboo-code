# ADR: 先落地通用工具事件协议

## 状态

已接受。

## 背景

项目正在从普通流式聊天接口过渡到 code agent runtime。当前阶段需要让前端能看到 agent 的工具调用过程，但暂时不需要确定第一版工具清单、敏感操作授权和具体工具参数 schema。

LangChain4j AI Service 已经接入现有 `WeatherTool`，并且 `TokenStream` 提供文本增量、工具执行前、工具执行后、完成和错误回调，可以在不重写模型循环的前提下获取工具生命周期。

## 决策

- `AiCodeService.chatStream` 返回 `TokenStream`，由业务层订阅回调并转换为统一 `SessionEvent`。
- 新增 `TOOL_CALL_STARTED`、`TOOL_CALL_COMPLETED`、`TOOL_CALL_FAILED`。
- 工具事件独立写入 JSONL，不塞进 `ASSISTANT_MESSAGE`。
- 前端把工具事件按 `turnId + toolCallId` 归并为助手消息内的可折叠工具轨迹。
- 本阶段不新增具体 code agent 工具列表，不新增 `APPROVAL_REQUIRED` / `APPROVAL_RESOLVED` 和授权接口。

## 影响

- 普通文本流式回复仍通过 `ASSISTANT_MESSAGE_DELTA` 展示，且不写入 JSONL。
- 工具调用过程可以被审计和回放。
- 后续增加文件读写、命令执行、授权交互时，可以复用现有事件协议，只扩展 payload 或新增授权事件。
