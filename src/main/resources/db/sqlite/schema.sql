-- 时间使用 `TEXT` 保存 RFC3339/ISO 8601 时间字符串，建议统一写 UTC，方便排序

CREATE TABLE IF NOT EXISTS mboo_sessions (
                          id TEXT PRIMARY KEY, -- 会话 ID
                          title TEXT NOT NULL DEFAULT '', -- 会话标题
                          status TEXT NOT NULL DEFAULT 'active' -- 会话状态：`active` 活跃、`archived` 已归档
                              CHECK (status IN ('active', 'archived')),
                          transcript_uri TEXT, -- 会话文件路径或相对 URI
                          workspace_path TEXT, -- 会话工作区绝对路径
                          active_turn_id TEXT, -- 当前运行中的 turn ID
                          created_at TEXT, -- 会话创建时间
                          updated_at TEXT, -- 会话最近更新时间
                          archived_at TEXT, -- 会话归档时间
                          metadata_json TEXT NOT NULL DEFAULT '{}' -- 会话扩展元数据，JSON 字符串，例如 UI 设置等
);

CREATE INDEX IF NOT EXISTS idx_sessions_list
    ON mboo_sessions(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_active_turn
    ON mboo_sessions(active_turn_id)
    WHERE active_turn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mboo_chat_memory (
                          memory_id TEXT PRIMARY KEY, -- 会话 ID
                          messages_json TEXT NOT NULL DEFAULT '[]', -- 模型使用的近期聊天消息
                          summary_text TEXT, -- 早期历史摘要
                          last_model_id TEXT, -- 上一次聊天实际使用的模型 ID
                          last_context_usage_json TEXT, -- 最近一次有效主对话 ContextUsageSnapshot JSON
                          last_context_limit INTEGER, -- 产生该 usage 时模型的上下文窗口
                          last_usage_at TEXT, -- 最近一次有效主对话 usage 时间
                          summary_updated_at TEXT, -- 最近一次模型摘要成功提交时间
                          pending_compression_event_json TEXT, -- 已提交但未确认写入 JSONL 的压缩完成事件
                          updated_at TEXT NOT NULL -- 会话记忆最近更新时间
);

CREATE TABLE IF NOT EXISTS mboo_model_context_preference (
                          model_id TEXT PRIMARY KEY, -- 供应商实际模型 ID，区分大小写
                          context_limit INTEGER NOT NULL, -- 用户保存的上下文窗口上限
                          created_at TEXT NOT NULL, -- 偏好创建时间
                          updated_at TEXT NOT NULL -- 偏好最近更新时间
);
