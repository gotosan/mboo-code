# Code Agent 任务清单

## 当前
- 上下文记忆
- 新增工具
- 项目文件夹

## 目标定位

本项目目标是做一个类似 Codex 的 code agent 后端 runtime。

第一版重点不是普通聊天，而是让 agent 能在指定工作区内理解代码、调用工具、修改文件、执行命令，并且把整个过程记录成可恢复、可审计的会话事件日志。

## 已确认决策

- 前端会单独配套开发，但不放入本文任务清单。
- agent 第一版允许修改文件。
- shell 命令、文件修改等授权状态由前端请求传入。
- 模型层需要支持多 provider，不应把业务代码绑定到单一 OpenAI 实现。
- 优先做“像 Codex 一样能改代码”的 agent，而不是只做可恢复聊天 runtime。

## 第一阶段 MVP

第一阶段要跑通这条最小闭环：

```text
/session/chat
  -> 创建 session / turn
  -> 记录用户输入事件
  -> 构建模型上下文
  -> 模型决定读取文件
  -> 执行 read_file 工具
  -> 模型决定修改文件
  -> 执行 apply_patch 或 write_file 工具
  -> 记录 diff 和工具结果
  -> 模型总结修改
  -> turn 完成
  -> JSONL 可以回放整个过程
```

做到这个闭环后，项目就从“流式聊天接口”进入“能改代码的 agent runtime”。

## 任务清单

### 1. 定义 Agent 请求协议

- 扩展当前 `ChatReq`，让它能表达 code agent 执行所需的上下文。
- 建议字段：
  - `sessionId`：为空时创建新会话。
  - `userMessage`：用户本轮请求。
  - `workspacePath`：本轮允许操作的项目根目录。
  - `provider`：模型供应商，例如 `openai`、`anthropic`、`gemini`。
  - `modelName`：模型名称。
  - `reasoningEffort`：推理强度，仅 provider 支持时使用。
  - `approvalState`：前端传入的授权状态。
  - `allowedTools`：前端允许本轮使用的工具列表。
  - `metadata`：预留扩展字段。
- controller 只负责接收请求和返回 SSE，不在 controller 中拼上下文或处理 agent 循环。

### 2. 建立多 Provider 模型抽象

- 新增模型层抽象，避免业务代码直接依赖 OpenAI 或 LangChain4j 具体类。
- 建议接口：
  - `ModelProvider`：负责创建指定 provider 的 client。
  - `ModelClient`：负责普通调用和流式调用。
  - `ModelRequest`：统一表达消息、工具 schema、模型参数。
  - `ModelResponse`：统一表达文本、工具调用、usage、finish reason。
- 第一版可以只实现 OpenAI provider，但接口必须为后续扩展保留空间。
- provider 配置从 setting 或请求参数中解析，避免硬编码模型名称。

### 3. 落地 Session JSONL 事件日志

- 基于 [session-event-jsonl-design.md](./session-event-jsonl-design.md) 实现最小事件集。
- 第一批事件类型：
  - `USER_MESSAGE`
  - `ASSISTANT_MESSAGE_DELTA`
  - `ASSISTANT_MESSAGE`
  - `TOOL_CALL_STARTED`
  - `TOOL_CALL_ENDED`
  - `ERROR`
  - `CANCELLED`
- 新增 `SessionEventStore`：
  - 追加写入 JSONL。
  - 按文件行顺序 replay。
  - 忽略或修复最后一行半截坏 JSON。
- JSONL 是事实来源，数据库只保存 session 索引和最近状态。

### 4. 完善 SessionService 与 TurnService

- 当前通过 `SessionService.getActiveOrCreateSession()` 创建或加载活跃会话，通过 `TurnService.startTurn()` 创建 turn。
- 能力要求：
  - `sessionId` 为空时创建 session。
  - 生成 transcript JSONL 路径。
  - 写入 `mboo_sessions` 表。
  - `sessionId` 不为空时加载 session。
  - 校验 session 状态不是 `archived` 或 `deleted`。
  - 校验同一 session 同一时间最多一个 running turn。
- 当前主要方法：
  - `createSession`
  - `getSession`
  - `getActiveOrCreateSession`
  - `startTurn`
  - `clearActiveTurn`

### 5. 实现 AgentRuntime 主循环

- 新增 `AgentRuntime`，承接真正的 agent 执行流程。
- 主流程：
  - 创建或加载 session。
  - 创建 turn。
  - 写入用户消息事件。
  - 调用 `ContextBuilder` 构建模型输入。
  - 调用 `ModelClient`。
  - 如果模型返回工具调用，则执行工具。
  - 工具结果写入事件日志。
  - 把工具结果继续放入上下文，再次调用模型。
  - 直到模型返回最终回答或进入等待确认状态。
- 需要限制最大循环次数，避免模型反复调用工具无法结束。
- turn 失败时必须写入 `ERROR`。

### 6. 建立工具系统

- 新增统一工具接口 `AgentTool`。
- 建议字段和方法：
  - `name`
  - `description`
  - `parametersSchema`
  - `sideEffect`
  - `requiresApproval`
  - `execute`
- 新增 `ToolRegistry` 管理可用工具。
- 工具执行前后都必须写事件：
  - 执行前写 `TOOL_CALL_STARTED`。
  - 执行后写 `TOOL_CALL_ENDED`。
  - 服务恢复时发现 started 但没有 ended 的工具，本阶段先按未完成状态处理，后续再补充不可确认状态事件。

### 7. 第一批工具

- `list_files`
  - 列出工作区内文件。
  - 支持路径、深度、忽略规则。
- `read_file`
  - 读取工作区内文件。
  - 支持行范围。
  - 输出需要截断，避免一次塞爆上下文。
- `search_text`
  - 在工作区内搜索文本。
  - 优先使用 `rg`。
  - 返回文件、行号、匹配片段。
- `apply_patch`
  - 对已有文件应用 patch。
  - 修改前后记录 diff 摘要。
  - 必须限制在 `workspacePath` 内。
- `write_file`
  - 创建或覆盖文件。
  - 默认需要授权。
  - 记录原文件是否存在、写入大小和 diff 摘要。
- `run_shell_command`
  - 在工作区内执行命令。
  - 支持超时、输出截断、退出码。
  - 根据前端 `approvalState` 判断是否允许执行。

### 8. 文件修改安全边界

- 所有工具都必须把路径解析成绝对路径。
- 解析后的路径必须位于 `workspacePath` 内。
- 禁止通过 `..`、符号链接或不同盘符绕过工作区限制。
- 修改文件前记录旧状态。
- 修改文件后记录新状态和 diff 摘要。
- JSONL 中保存给模型看的截断结果，不直接保存大文件或二进制内容。

### 9. 命令执行策略

- `run_shell_command` 必须支持：
  - `command`
  - `cwd`
  - `timeoutMs`
  - `maxOutputChars`
  - `approvalRequired`
  - `approvalState`
- 危险命令不能直接执行，应返回等待确认事件。
- 第一版可以先把以下命令归为需要确认：
  - 删除文件或目录。
  - 移动大量文件。
  - 修改 git 状态的命令。
  - 安装依赖。
  - 启动长时间后台进程。
- 命令输出要记录 stdout、stderr、exit code、duration。

### 10. 实现 ContextBuilder

- 新增 `ContextBuilder` 统一组装模型输入。
- 输入来源：
  - system prompt。
  - 当前用户消息。
  - 最近会话消息。
  - 已完成工具调用结果。
  - 当前工作区信息。
  - 历史摘要。
  - 可用工具 schema。
- controller、service 和 tool 都不直接拼 prompt。
- 后续上下文压缩也从这里接入。

### 11. 改造 SSE 输出协议

- `/session/chat` 不应只返回文本 chunk。
- SSE 需要能表达 agent 执行过程。
- 第一版事件：
  - `ASSISTANT_MESSAGE_DELTA`
  - `TOOL_CALL_STARTED`
  - `TOOL_CALL_ENDED`
  - `FILE_CHANGED`
  - `COMMAND_OUTPUT`
  - `APPROVAL_REQUIRED`
  - `ASSISTANT_MESSAGE`
  - `ERROR`
  - `CANCELLED`
- SSE 固定使用 `session`，消息体使用统一 `SessionEvent`，前端按 `data.type` 分发。
- 不单独发送 assistant started 事件，第一条 `ASSISTANT_MESSAGE_DELTA` 携带 `messageId` 并表示助手消息开始。

### 12. 实现会话读取接口

- 当前会话接口：
  - `GET /session/list`
  - `GET /session/{sessionId}`
  - `GET /session/{sessionId}/events`
  - `PATCH /session/{sessionId}`
  - `POST /session/{sessionId}/archive`
  - `DELETE /session/{sessionId}`
- 第一版可以全量 replay JSONL。
- 后续再实现分页、index 和 snapshot。
- 当前归档和删除接口只校验会话存在，尚未真正修改或删除数据。

### 13. 恢复中断任务

- 服务启动或请求继续执行时，读取 JSONL。
- 找到最后一个未完成 turn。
- 检查是否有 `TOOL_CALL_STARTED` 但没有 `TOOL_CALL_ENDED`。
- 本阶段先不为这些工具补写额外事件，只在恢复逻辑中识别为结果未确认。
- 由 agent 根据上下文判断继续、重试、失败或请求用户确认。
- 不自动重试有副作用的工具。

### 14. 测试清单

- `SessionEventStore`：
  - 事件追加写入。
  - replay 顺序正确。
  - 最后一行坏 JSON 可处理。
- `SessionService`：
  - 新建 session。
  - 加载已有 session。
  - 阻止 archived/deleted session 继续执行。
  - 阻止同一 session 并发 turn。
- 工具安全：
  - 路径越界被拒绝。
  - `read_file` 行范围正确。
  - `apply_patch` 只修改工作区内文件。
  - `run_shell_command` 超时生效。
  - 命令输出被截断。
- AgentRuntime：
  - 单次普通回答。
  - 读文件后回答。
  - 修改文件后总结。
  - 工具失败后写入失败事件。
  - 达到最大循环次数后停止。

## 推荐实现顺序

1. `SessionService` + `SessionEventStore`
2. 最小事件模型
3. 改造 `/session/chat` 写入用户消息和 assistant 文本事件
4. `ModelClient` / `ModelProvider` 抽象
5. `AgentRuntime` 主循环
6. `ToolRegistry` + `read_file` + `list_files`
7. `apply_patch` + `write_file`
8. `run_shell_command`
9. SSE agent 事件协议
10. 会话 replay 接口
11. 中断恢复
12. 测试补齐

## 暂不做

- 前端页面实现。
- 多用户权限系统。
- 远程 workspace。
- 分布式任务执行。
- 完整历史分页索引。
- 自动上下文压缩。
- 复杂 planner / sub-agent。

这些内容等第一阶段闭环稳定后再加。
