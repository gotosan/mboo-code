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

可以通过公开环境变量设置页面默认模型名：

```powershell
$env:NEXT_PUBLIC_MBOO_DEFAULT_MODEL="模型名称"
```

打开 [http://localhost:3000](http://localhost:3000) 使用会话页面。

## 前后端接口

| 前端接口 | 后端接口 | 说明 |
| --- | --- | --- |
| `GET /api/session/list` | `GET /session/list` | 查询活跃会话 |
| `GET /api/session/{sessionId}` | `GET /session/{sessionId}` | 查询会话详情 |
| `GET /api/session/{sessionId}/events` | `GET /session/{sessionId}/events` | 全量读取 JSONL 会话事件 |
| `PATCH /api/session/{sessionId}` | `PATCH /session/{sessionId}` | 更新会话标题 |
| `POST /api/session/{sessionId}/archive` | `POST /session/{sessionId}/archive` | 归档接口，当前后端仅校验会话存在 |
| `DELETE /api/session/{sessionId}` | `DELETE /session/{sessionId}` | 删除接口，当前后端仅校验会话存在 |
| `POST /api/session/chat` | `POST /session/chat` | 代理 SSE 会话事件流 |

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

聊天请求字段为 `modelName`、`reasoningEffort`、`userMessage` 和 `sessionId`。`sessionId` 为空字符串时，后端会创建新会话。

## SSE 事件

后端 SSE 事件名固定为 `session`，`data` 是完整 `SessionEvent`。当前事件类型包括：

- `USER_MESSAGE`
- `ASSISTANT_MESSAGE_DELTA`
- `ASSISTANT_MESSAGE`
- `TOOL_CALL_STARTED`
- `TOOL_CALL_ENDED`
- `ERROR`
- `CANCELLED`

`ASSISTANT_MESSAGE.state` 使用 `complete`、`cancel`、`error`。工具结束状态使用 `completed`、`failed`，两组状态值不能混用。

更完整的字段说明见 [Session Event Payload 字段说明](../docs/session-event-payload-fields.md)。
