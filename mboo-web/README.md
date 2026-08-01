# Mboo Web

Mboo Code 的 Next.js 前端，通过同源 Route Handler 代理 Spring Boot 后端，避免浏览器直接跨域访问后端。

## 启动

先在项目根目录启动后端：

```powershell
.\gradlew.bat bootRun
```

再启动前端：

```powershell
cd mboo-web
npm install
npm run dev
```

默认后端地址为 `http://localhost:8080`。需要修改时设置服务端环境变量：

```powershell
$env:MBOO_API_BASE_URL="http://localhost:8080"
```

当前版本仅支持 OpenAI Responses API 接口，不支持 Chat Completions API，也不支持通过 `provider` 切换其他模型供应商。后端 `.mboo/setting.json` 使用 `api_key` 和 `base_url` 配置接口访问参数，不再包含 `provider` 字段。

打开 [http://localhost:3000](http://localhost:3000) 使用会话页面。

## 前后端接口

| 前端接口 | 后端接口 | 说明 |
| --- | --- | --- |
| `GET /api/model/list` | `GET /config/modelList` | 查询后端启动时缓存的模型候选 |
| `GET /api/session/list` | `GET /session/list` | 查询活跃会话 |
| `GET /api/session/list/archived` | `GET /session/list/archived` | 查询归档会话 |
| `GET /api/session/{sessionId}` | `GET /session/{sessionId}` | 查询会话详情（打开会话时与 events 并行拉取） |
| `GET /api/session/{sessionId}/events` | `GET /session/{sessionId}/events` | 全量读取 JSONL 会话事件 |
| `PATCH /api/session/{sessionId}` | `PATCH /session/{sessionId}` | 更新会话标题 |
| `POST /api/session/{sessionId}/archive` | `POST /session/{sessionId}/archive` | 归档会话 |
| `POST /api/session/{sessionId}/unarchive` | `POST /session/{sessionId}/unarchive` | 取消归档会话 |
| `DELETE /api/session/{sessionId}` | `DELETE /session/{sessionId}` | 删除会话 |
| `POST /api/session/{sessionId}/approvals/{approvalId}` | `POST /session/{sessionId}/approvals/{approvalId}` | 处理工具授权（`ALLOW_ONCE` / `ALLOW_SESSION` / `DENY`） |
| `POST /api/session/chat` | `POST /session/chat` | 代理 SSE 会话事件流 |
| `POST /api/workspace/select-directory` | `POST /config/selectDirectory` | 打开本机工作区目录选择窗口 |

普通 JSON 接口使用后端统一响应结构：

```json
{
  "success": true,
  "data": {},
  "code": 200,
  "msg": "成功",
  "exception": ""
}
```

聊天请求字段为 `modelName`、`reasoningEffort`、`userMessage`、`workspacePath` 和 `sessionId`。`sessionId` 为空字符串时，后端会创建新会话；此时 `workspacePath` 为空会自动创建 `.mboo/workspaces/{yyyy-MM-dd}/{sessionId}`，已有会话会忽略请求中的工作区路径。

模型输入支持从候选列表选择或手动填写。打开已有会话时优先使用该会话最后一条用户消息记录的模型；新会话优先使用浏览器保存的上一次发送模型，没有保存值时使用候选列表第一项。候选列表由后端启动时查询一次，更新供应商配置或模型后需要重启后端。

工具授权请求字段为 `decision`：`ALLOW_ONCE`（允许本次）、`ALLOW_SESSION`（本会话允许）、`DENY`（拒绝）。`approvalId` 来自 SSE 事件 `TOOL_APPROVAL_REQUIRED.payload.approvalId`。

## SSE 事件

后端 SSE 事件名固定为 `session`，`data` 是完整 `SessionEvent`。当前事件类型包括：

- `USER_MESSAGE`
- `ASSISTANT_MESSAGE_DELTA`
- `ASSISTANT_MESSAGE`
- `TOOL_CALL_STARTED`
- `TOOL_APPROVAL_REQUIRED`
- `TOOL_CALL_ENDED`
- `ERROR`
- `CANCELLED`

`ASSISTANT_MESSAGE.state` 使用 `complete`、`cancel`、`error`。工具结束状态使用 `completed`、`failed`，两组状态值不能混用。

更完整的字段说明见 [Session Event Payload 字段说明](../docs/会话事件Payload字段说明.md)。
