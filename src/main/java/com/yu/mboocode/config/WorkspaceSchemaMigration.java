package com.yu.mboocode.config;

import cn.hutool.core.util.IdUtil;
import com.yu.mboocode.common.util.DateTimeUtil;
import com.yu.mboocode.agent.util.WorkspacePathUtil;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 保存工作区表、会话关联列和历史归属的轻量迁移。
 */
@Component
@Slf4j
public class WorkspaceSchemaMigration {
    @Resource
    private JdbcTemplate jdbcTemplate;
    @Resource
    private TransactionTemplate transactionTemplate;

    @PostConstruct
    public void migrate() {
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS mboo_workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL, created_at TEXT NOT NULL)");
        jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_path_key ON mboo_workspaces(path_key)");
        addWorkspaceIdColumn();
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_sessions_workspace_status ON mboo_sessions(workspace_id, status, updated_at DESC)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_sessions_workspace_archived ON mboo_sessions(workspace_id, status, archived_at DESC)");
        migrateHistoricalSessions();
    }

    private void addWorkspaceIdColumn() {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("PRAGMA table_info(mboo_sessions)");
        Set<String> existingColumns = new HashSet<>();
        for (Map<String, Object> row : rows) existingColumns.add(String.valueOf(row.get("name")));
        if (existingColumns.contains("workspace_id")) return;
        jdbcTemplate.execute("ALTER TABLE mboo_sessions ADD COLUMN workspace_id TEXT");
        log.info("mboo_sessions 补充列 workspace_id 完成");
    }

    private void migrateHistoricalSessions() {
        List<Map<String, Object>> sessions = jdbcTemplate.queryForList("SELECT id, workspace_path FROM mboo_sessions WHERE workspace_id IS NULL AND workspace_path IS NOT NULL AND TRIM(workspace_path) <> ''");
        for (Map<String, Object> session : sessions) {
            String sessionId = String.valueOf(session.get("id"));
            String workspacePath = String.valueOf(session.get("workspace_path"));
            if (WorkspacePathUtil.isDefaultWorkspacePath(workspacePath, sessionId)) continue;
            try {
                String normalizedPath = WorkspacePathUtil.normalizeExistingDirectory(workspacePath);
                String pathKey = WorkspacePathUtil.pathKey(normalizedPath);
                transactionTemplate.executeWithoutResult(_ -> {
                    jdbcTemplate.update("INSERT OR IGNORE INTO mboo_workspaces(id, path, path_key, created_at) VALUES (?, ?, ?, ?)", IdUtil.getSnowflakeNextIdStr(), normalizedPath, pathKey, DateTimeUtil.now());
                    String workspaceId = jdbcTemplate.queryForObject("SELECT id FROM mboo_workspaces WHERE path_key = ?", String.class, pathKey);
                    jdbcTemplate.update("UPDATE mboo_sessions SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL", workspaceId, sessionId);
                });
            } catch (Exception e) {
                log.warn("历史会话工作区迁移失败，暂归任务 sessionId:{} path:{} reason:{}", sessionId, workspacePath, e.getMessage());
            }
        }
    }
}
