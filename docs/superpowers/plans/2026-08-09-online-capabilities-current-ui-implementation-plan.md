# 线上能力接入当前前端实施计划

> **For agentic workers:** 本计划按任务逐项执行；每个任务完成后先验证并停下来确认，再继续下一个任务。

**Goal:** 在保留当前前端 UI 和已有功能的前提下，接入线上后端的工作区管理、完全访问、模型上下文上限、上下文用量和上下文压缩能力。

**Architecture:** 后端以 `origin/main` 的接口、数据库和事件协议为准；前端保留当前 `features/*` 组件和 UI 规范，由页面层统一处理 API、SSE、JSONL 和领域状态，展示组件只通过 props 接收数据和回调。线上单体 `page.tsx` 不直接覆盖当前前端。

**Tech Stack:** Spring Boot、SQLite、MyBatis、Next.js App Router、React、TypeScript、CSS Modules、SSE、JSONL。

---

## 范围与约束

本计划只处理当前前端确实缺失的能力：

- 工作区持久化管理；
- 会话级 `DEFAULT` / `FULL_ACCESS` 权限模式；
- 模型上下文上限查询、保存和恢复默认；
- 上下文用量展示；
- 手动上下文压缩及其实时/历史状态。

保留现有实现，不重做：会话 CRUD、模型候选和手动输入、目录选择、流式消息、工具轨迹、工具结果、工具授权卡、当前主题、移动端抽屉和消息滚动。

项目规则要求仅在用户主动要求后新增单元测试，因此本计划不创建单元测试文件；使用类型检查、构建、差异检查和手测清单完成验证。

## 文件边界总览

### 后端同步与接口契约

- Modify: `build.gradle`
- Modify: `src/main/java/com/yu/mboocode/agent/controller/ConfigController.java`
- Modify: `src/main/java/com/yu/mboocode/agent/controller/SessionController.java`
- Create: `src/main/java/com/yu/mboocode/agent/controller/WorkspaceController.java`
- Modify: `src/main/java/com/yu/mboocode/agent/dto/ActiveTurnRuntime.java`
- Modify: `src/main/java/com/yu/mboocode/agent/dto/ChatReq.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/ContextCompressReq.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/ModelContextLimitReq.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/ModelContextLimitResp.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/SessionPermissionModeReq.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/WorkspaceCreateReq.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/WorkspaceDeleteResp.java`
- Create: `src/main/java/com/yu/mboocode/agent/dto/WorkspaceResp.java`
- Modify: `src/main/java/com/yu/mboocode/agent/enums/SessionEventType.java`
- Create: `src/main/java/com/yu/mboocode/agent/enums/TurnOperationType.java`
- Create: `src/main/java/com/yu/mboocode/agent/mapper/ModelContextPreferenceMapper.java`
- Create: `src/main/java/com/yu/mboocode/agent/mapper/WorkspaceMapper.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/ContextUsageSnapshot.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/ModelContextPreference.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/ModelInfo.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/ModelLimit.java`
- Modify: `src/main/java/com/yu/mboocode/agent/model/SessionTurn.java`
- Modify: `src/main/java/com/yu/mboocode/agent/model/Sessions.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/Workspace.java`
- Modify: `src/main/java/com/yu/mboocode/agent/model/payload/AssistantMessagePayload.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/payload/ContextCompressionPayload.java`
- Create: `src/main/java/com/yu/mboocode/agent/model/payload/ContextUsageUpdatedPayload.java`
- Create: `src/main/java/com/yu/mboocode/agent/service/ModelContextPreferenceService.java`
- Create: `src/main/java/com/yu/mboocode/agent/service/ModelMetadataService.java`
- Modify: `src/main/java/com/yu/mboocode/agent/service/ModelOptionService.java`
- Create: `src/main/java/com/yu/mboocode/agent/service/ModelUsageTracker.java`
- Modify: `src/main/java/com/yu/mboocode/agent/service/SessionEventStore.java`
- Modify: `src/main/java/com/yu/mboocode/agent/service/SessionService.java`
- Modify: `src/main/java/com/yu/mboocode/agent/service/TurnService.java`
- Create: `src/main/java/com/yu/mboocode/agent/service/WorkspaceService.java`
- Modify: `src/main/java/com/yu/mboocode/agent/tool/ToolApprovalService.java`
- Create: `src/main/java/com/yu/mboocode/agent/tool/permission/PermissionMode.java`
- Create: `src/main/java/com/yu/mboocode/agent/util/WorkspacePathUtil.java`
- Create: `src/main/java/com/yu/mboocode/config/ChatMemorySchemaMigration.java`
- Create: `src/main/java/com/yu/mboocode/config/WorkspaceSchemaMigration.java`
- Modify: `src/main/java/com/yu/mboocode/llm/AiCodeService.java`
- Modify: `src/main/java/com/yu/mboocode/llm/AiCodeServiceFactory.java`
- Create: `src/main/java/com/yu/mboocode/llm/ContextSummaryAiService.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/ChatMemoryTurnParser.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/ContextEstimateUtil.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/ContextManagementService.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/ContextSummaryService.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/ConversationTurn.java`
- Create: `src/main/java/com/yu/mboocode/llm/context/MemoryToolConclusionFormatter.java`
- Create: `src/main/java/com/yu/mboocode/llm/listener/ModelUsageRequestListener.java`
- Create: `src/main/java/com/yu/mboocode/llm/listener/ModelUsageResponseListener.java`
- Delete: `src/main/java/com/yu/mboocode/llm/listener/MyAiServiceCompletedListener.java`
- Delete: `src/main/java/com/yu/mboocode/llm/listener/MyChatModelListener.java`
- Modify: `src/main/java/com/yu/mboocode/llm/model/ChatMemory.java`
- Modify: `src/main/java/com/yu/mboocode/llm/service/ChatMemoryService.java`
- Modify: `src/main/java/com/yu/mboocode/llm/service/PersistentChatMemoryStore.java`
- Modify: `src/main/resources/db/sqlite/schema.sql`
- Create: `src/main/resources/prompt/context-summary-prompt.txt`
- Rename: `src/main/resources/system-prompt.txt` to `src/main/resources/prompt/system-prompt.txt`

### 前端 API 与类型

- Modify: `mboo-web/src/lib/session-types.ts`
- Modify: `mboo-web/src/lib/backend-api.ts`
- Create: `mboo-web/src/app/api/workspace/list/route.ts`
- Create: `mboo-web/src/app/api/workspace/route.ts`
- Create: `mboo-web/src/app/api/workspace/[workspaceId]/route.ts`
- Create: `mboo-web/src/app/api/model/[modelId]/route.ts`
- Create: `mboo-web/src/app/api/model/[modelId]/context-limit/route.ts`
- Create: `mboo-web/src/app/api/session/[sessionId]/permission-mode/route.ts`
- Create: `mboo-web/src/app/api/session/[sessionId]/context/compress/route.ts`

### 当前前端组件

- Modify: `mboo-web/src/app/page.tsx`
- Modify: `mboo-web/src/features/sessions/session-types.ts`
- Modify: `mboo-web/src/features/sessions/session-list-panel.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.module.css`
- Modify: `mboo-web/src/features/context-rail/context-rail.tsx`
- Modify: `mboo-web/src/features/context-rail/context-rail.module.css`
- Modify: `mboo-web/src/features/agent-run/message-model.ts`
- Modify: `mboo-web/src/features/conversation/message-list.tsx`
- Modify: `mboo-web/src/features/conversation/message-bubble.tsx`
- Modify: `mboo-web/src/features/workbench/workbench-layout.module.css`

## Task 0: 建立可恢复基线

**目标：** 在任何后端同步前保护当前工作区的未提交改动和未跟踪组件。

**Files:**

- 不修改业务文件；只操作 Git 工作区和独立集成分支。

- [ ] **Step 1: 记录当前状态和当前前端文件清单**

```bash
rtk run git status --short
rtk run git diff -- mboo-web/src/app/page.tsx mboo-web/src/app/globals.css mboo-web/src/app/layout.tsx mboo-web/package.json mboo-web/package-lock.json
rtk run rg --files mboo-web/src/features mboo-web/src/styles mboo-web/src/app/preview
```

Expected: 只确认现有前端改动，不修改任何文件。

- [ ] **Step 2: 创建临时备份引用并生成集成 worktree**

```bash
rtk run git stash push -u -m "before online capabilities integration 20260809"
rtk run git worktree add -b feature/online-capabilities-current-ui ../mboo-code-integration origin/main
```

Expected: 当前工作区改动进入可恢复 stash，集成目录基于 `origin/main`，当前工作区不再承载合并冲突。

- [ ] **Step 3: 确认集成目录干净且远程基线正确**

```bash
rtk run git status -sb
rtk run git log -1 --oneline
rtk run git rev-list --left-right --count HEAD...origin/main
```

Expected: 集成分支干净，HEAD 等于当前 `origin/main`，未修改原工作区的其他资产。

## Task 1: 同步后端依赖链并验证启动边界

**目标：** 在集成 worktree 中采用线上后端完整依赖链，确认数据库迁移、模型服务和上下文服务可以编译。

**Files:**

- 采用 Task 0 建立的 `src/main/java`、`src/main/resources` 和 `build.gradle` 远程版本；
- 不替换当前前端组件目录。

- [ ] **Step 1: 核对后端差异只来自线上基线**

```bash
rtk run git diff --name-status HEAD origin/main -- src build.gradle
rtk run git diff --stat HEAD origin/main -- src build.gradle
```

Expected: 后端差异与已确认的线上功能依赖链一致，不出现当前用户未提交后端改动。

- [ ] **Step 2: 验证 Gradle 编译和资源存在**

```bash
rtk run ./gradlew compileJava
rtk run test -f src/main/resources/prompt/context-summary-prompt.txt
rtk run test -f src/main/resources/prompt/system-prompt.txt
```

Expected: Java 编译成功，两个 Prompt 文件存在；不启动常驻服务。

- [ ] **Step 3: 提交后端基线**

```bash
rtk run git add build.gradle src/main/java src/main/resources
rtk run git commit -m "feat:同步线上上下文与工作区后端能力"
```

Expected: 只提交线上后端依赖链，不提交当前前端重构文件。

## Task 2: 对齐前后端契约和 API 代理

**目标：** 让当前前端可以表达线上新增请求、响应和事件，不改变页面布局。

**Files:**

- Modify: `mboo-web/src/lib/session-types.ts`
- Modify: `mboo-web/src/lib/backend-api.ts`
- Create: `mboo-web/src/app/api/workspace/list/route.ts`
- Create: `mboo-web/src/app/api/workspace/route.ts`
- Create: `mboo-web/src/app/api/workspace/[workspaceId]/route.ts`
- Create: `mboo-web/src/app/api/model/[modelId]/route.ts`
- Create: `mboo-web/src/app/api/model/[modelId]/context-limit/route.ts`
- Create: `mboo-web/src/app/api/session/[sessionId]/permission-mode/route.ts`
- Create: `mboo-web/src/app/api/session/[sessionId]/context/compress/route.ts`

- [ ] **Step 1: 增加事件和领域类型**

在 `session-types.ts` 增加并保持与远程字段一致：

- `PermissionMode`；
- `ModelInfo`、`ModelLimit`、`ModelContextLimit`；
- `ContextUsageSnapshot`；
- `ContextUsageUpdatedPayload`；
- `ContextCompressionPayload`；
- `CONTEXT_USAGE_UPDATED`、`CONTEXT_COMPRESSION`；
- `ChatReq.permissionMode`；
- `AssistantMessagePayload.contextUsage`；
- 保留现有 `ToolPermissionType`、`ToolResultDetail` 和授权阶段字段。

Run:

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
```

Expected: 类型定义自身无错误；调用方错误可以在后续任务逐步消除。

- [ ] **Step 2: 添加 API 代理**

每个代理只负责读取请求、编码动态路径并调用 `proxyBackendJson`：

- 工作区：`GET /workspace/list`、`POST /workspace`、`DELETE /workspace/{workspaceId}`；
- 模型详情：`GET /config/model?modelId={modelId}`；
- 上下文上限：`GET/PUT/DELETE /config/modelContextLimit?modelId={modelId}`；
- 权限模式：`PUT /session/{sessionId}/permission-mode`；
- 上下文压缩：`POST /session/{sessionId}/context/compress`。

Expected: API route 不包含业务状态，不在组件内直接拼接后端地址。

- [ ] **Step 3: 提交契约层**

```bash
rtk run git add mboo-web/src/lib mboo-web/src/app/api
rtk run git commit -m "feat:补齐线上能力前端接口契约"
```

## Task 3: 接入工作区持久化管理

**Goal:** 在当前 UI 中增加工作区列表、保存和删除，同时保留现有目录选择。

**Files:**

- Modify: `mboo-web/src/app/page.tsx`
- Modify: `mboo-web/src/features/sessions/session-types.ts`
- Modify: `mboo-web/src/features/sessions/session-list-panel.tsx`
- Modify: `mboo-web/src/features/context-rail/context-rail.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.module.css`

- [ ] **Step 1: 增加页面层工作区状态**

在页面层维护 `workspaces`、加载状态、保存状态、删除状态和当前会话 `workspaceId`；首次加载与会话列表并行请求 `/api/workspace/list`，失败时保留当前目录选择和新建任务能力。

- [ ] **Step 2: 将目录选择结果保存为工作区**

选择目录成功后，提供“保存为工作区”动作；提交 `{ name, path }`，成功后刷新工作区列表并以返回的工作区对象作为新会话选择项。保存失败只显示当前操作错误，不清空已选路径。

- [ ] **Step 3: 在现有会话列表样式中展示工作区**

复用当前行、菜单和确认弹层样式，不改变会话行高度；工作区删除确认必须显示工作区名称、路径和关联会话数量，并明确磁盘目录不会被删除。

- [ ] **Step 4: 验证工作区行为并提交**

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
rtk run git diff --check
rtk run git add mboo-web/src/app/page.tsx mboo-web/src/features/sessions mboo-web/src/features/context-rail mboo-web/src/features/composer
rtk run git commit -m "feat:在当前前端接入工作区管理"
```

Expected: 可新增、选择、切换和删除工作区；磁盘目录不受影响。

## Task 4: 接入模型能力和上下文上限

**Goal:** 在当前模型配置体验中增加模型能力加载和上下文上限配置，保留手动输入兜底。

**Files:**

- Modify: `mboo-web/src/app/page.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.module.css`
- Modify: `mboo-web/src/features/context-rail/context-rail.tsx`
- Modify: `mboo-web/src/features/context-rail/context-rail.module.css`

- [ ] **Step 1: 增加模型详情和上下文配置状态**

模型名称变化时并行加载模型详情与上下文上限；响应的 `modelId` 与当前模型不一致时丢弃，避免快速切换模型造成旧请求覆盖新状态。模型详情失败时保留候选/手动输入，但禁止在能力未知时发送需要能力校验的任务。

- [ ] **Step 2: 以当前主题实现上下文上限控件**

在当前设置区或 `ContextRail` 增加紧凑信息块：显示有效上限、最大上限和是否可调；可调模型显示滑块、保存和恢复默认按钮。控件使用当前 CSS Module 的语义颜色和尺寸，不新增全局主题变量。

- [ ] **Step 3: 验证模型切换和配置持久化**

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
rtk run git diff --check
rtk run git add mboo-web/src/app/page.tsx mboo-web/src/features/composer mboo-web/src/features/context-rail
rtk run git commit -m "feat:在当前前端接入模型上下文配置"
```

Expected: 模型切换不会串用旧配置；保存和恢复默认后刷新页面仍显示后端有效值。

## Task 5: 接入上下文用量和上下文压缩

**Goal:** 统一处理实时 SSE、历史 JSONL 和压缩操作，让 ContextRail 展示真实上下文状态。

**Files:**

- Modify: `mboo-web/src/app/page.tsx`
- Modify: `mboo-web/src/features/agent-run/message-model.ts`
- Modify: `mboo-web/src/features/conversation/message-list.tsx`
- Modify: `mboo-web/src/features/conversation/message-bubble.tsx`
- Modify: `mboo-web/src/features/context-rail/context-rail.tsx`
- Modify: `mboo-web/src/features/context-rail/context-rail.module.css`

- [ ] **Step 1: 统一上下文用量归并**

处理 `CONTEXT_USAGE_UPDATED` 和终态消息中的 `contextUsage`：按 `sessionId + modelId` 保存当前会话用量；切换会话时从历史事件恢复最近用量；模型切换时清除不匹配的用量。

- [ ] **Step 2: 展示用量且不改变主滚动槽**

在 `ContextRail` 增加 token 数值、百分比和进度条；无数据时只显示“等待本轮使用量”，不伪造比例。进度条只改变宽度，不改变布局高度；高占用使用稳定颜色和文字表达，不持续闪烁。

- [ ] **Step 3: 接入手动压缩状态**

页面层调用 `/api/session/{sessionId}/context/compress`，使用 `CONTEXT_COMPRESSION` 更新 `started/completed/failed/skipped` 状态。压缩开始后禁用发送和重复压缩，复用现有运行状态栏和停止机制；完成或失败后恢复操作状态。

- [ ] **Step 4: 接入历史系统提示**

将压缩结果转换为系统信息消息，不作为助手消息或用户消息；历史中未完成的压缩事件不能恢复为可操作的运行状态。

- [ ] **Step 5: 验证实时、历史和异常路径**

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
rtk run git diff --check
rtk run git add mboo-web/src/app/page.tsx mboo-web/src/features/agent-run mboo-web/src/features/conversation mboo-web/src/features/context-rail
rtk run git commit -m "feat:接入上下文用量和压缩状态"
```

Expected: 实时和历史显示一致；压缩失败不会丢失原会话消息；用户上滑阅读时不会被状态更新强制拉到底部。

## Task 6: 接入会话级完全访问

**Goal:** 在当前任务设置区域增加会话级权限模式，并保持工具审批卡的后端事件驱动。

**Files:**

- Modify: `mboo-web/src/app/page.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.tsx`
- Modify: `mboo-web/src/features/composer/task-composer.module.css`

- [ ] **Step 1: 新会话提交权限模式**

创建新会话时在 `ChatReq` 中仅对新会话附加 `permissionMode`；已有会话不重复发送创建参数。

- [ ] **Step 2: 已有会话更新权限模式**

切换已有会话时调用 `PUT /api/session/{sessionId}/permission-mode`，提交 `{ permissionMode }`；请求失败恢复旧值并显示非阻塞错误。

- [ ] **Step 3: 从元数据恢复并验证权限优先级**

打开会话时解析权限模式；工具审批事件仍然由 `ToolApprovalCard` 展示，前端不因为 `FULL_ACCESS` 自行隐藏后端发送的授权卡。

- [ ] **Step 4: 验证并提交**

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
rtk run git diff --check
rtk run git add mboo-web/src/app/page.tsx mboo-web/src/features/composer
rtk run git commit -m "feat:接入会话完全访问模式"
```

Expected: 新会话和已有会话的权限模式都能恢复和切换，单工具授权行为不被前端绕过。

## Task 7: 整体验证与 UI 回归

**Goal:** 验证新增功能没有破坏当前视觉规范、滚动、授权和长会话能力。

**Files:**

- Modify if needed: `docs/mboo-web-handtest-checklist.md`
- Do not modify: current theme assets, screenshots, unrelated untracked files.

- [ ] **Step 1: 执行静态验证**

```bash
rtk run env -u NODE_OPTIONS npx tsc --noEmit --project mboo-web/tsconfig.json
rtk run npm run build --prefix mboo-web
rtk run git diff --check
```

Expected: TypeScript、Next.js 生产构建和差异检查全部通过。

- [ ] **Step 2: 执行功能手测**

按以下路径验证：

- 创建工作区、切换工作区、删除工作区，确认磁盘目录仍存在；
- 新会话切换 `DEFAULT` / `FULL_ACCESS`，刷新后状态保持；
- 切换模型，确认上下文上限和模型能力不串用；
- 修改上限、恢复默认并重新加载；
- 触发上下文用量事件，确认 ContextRail 数值和比例更新；
- 手动压缩期间发送和重复压缩均被禁用；
- 压缩完成、失败、跳过和历史回放状态可理解；
- 长回复上滑后不被上下文状态更新拉回底部；
- 1440、1180、720、390 宽度及矮视口无横向溢出。

- [ ] **Step 3: 完成任务提交并保留用户资产**

```bash
rtk run git status --short
rtk run git log --oneline --decorate -8
```

Expected: 功能提交按任务拆分，未提交的用户前端改动和未跟踪资产仍明确可见，未被误纳入。

## 自检

- 需求覆盖：四类新增能力均有独立任务；当前已有功能列入保留范围；UI 规范列入回归验证。
- 依赖完整：工作区、模型配置、上下文压缩和权限模式的后端 DTO、Service、Schema、事件和 API 代理均已列出。
- 事件一致性：实时 SSE 与历史 JSONL 共用归并逻辑，未新增第二套展示链路。
- 样式边界：新功能只进入现有 feature 组件和 CSS Module，不覆盖主题或调整主滚动架构。
- 测试边界：未新增单元测试文件，遵循项目“仅用户主动要求后编写单元测试”的规则。
