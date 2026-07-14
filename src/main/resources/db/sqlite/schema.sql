-- 时间使用 `TEXT` 保存 RFC3339/ISO 8601 时间字符串，建议统一写 UTC，方便排序

CREATE TABLE IF NOT EXISTS mboo_sessions (
                          id TEXT PRIMARY KEY, -- 会话 ID
                          title TEXT NOT NULL DEFAULT '', -- 会话标题
                          status TEXT NOT NULL DEFAULT 'active' -- 会话状态：`active` 活跃、`archived` 已归档、`deleted` 已软删除
                              CHECK (status IN ('active', 'archived', 'deleted')),
                          transcript_uri TEXT, -- 会话文件路径或相对 URI
                          active_turn_id TEXT, -- 当前运行中的 turn ID
                          created_at TEXT, -- 会话创建时间
                          updated_at TEXT, -- 会话最近更新时间
                          archived_at TEXT, -- 会话归档时间
                          deleted_at TEXT, -- 会话删除时间
                          metadata_json TEXT NOT NULL DEFAULT '{}' -- 会话扩展元数据，JSON 字符串，例如工作区路径、UI 设置等
);

CREATE INDEX IF NOT EXISTS idx_sessions_list
    ON mboo_sessions(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_active_turn
    ON mboo_sessions(active_turn_id)
    WHERE active_turn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mboo_chat_memory (
                          memory_id TEXT PRIMARY KEY, -- 会话 ID
                          messages_json TEXT NOT NULL DEFAULT '[]', -- 模型使用的近期聊天消息
                          summary_text TEXT, -- 早期历史摘要，暂不启用上下文压缩时保持为空
                          updated_at TEXT NOT NULL -- 会话记忆最近更新时间
);
