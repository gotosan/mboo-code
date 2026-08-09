package com.yu.mboocode.agent.service;

import cn.hutool.core.thread.lock.LockUtil;
import cn.hutool.core.thread.lock.SegmentLock;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.agent.dto.WorkspaceDeleteResp;
import com.yu.mboocode.agent.dto.WorkspaceResp;
import com.yu.mboocode.agent.mapper.SessionsMapper;
import com.yu.mboocode.agent.mapper.WorkspaceMapper;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.model.Workspace;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.service.PersistentChatMemoryStore;
import com.yu.mboocode.util.WorkspacePathUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.locks.Lock;
import java.util.function.Supplier;

@Service
@Slf4j
public class WorkspaceService extends ServiceImpl<WorkspaceMapper, Workspace> {
    @Resource
    private SessionsMapper sessionsMapper;
    @Resource
    private PersistentChatMemoryStore persistentChatMemoryStore;
    @Resource
    private ToolResultStore toolResultStore;
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private TransactionTemplate transactionTemplate;

    private final SegmentLock<Lock> pathLocks = LockUtil.createLazySegmentLock(64);
    private final SegmentLock<Lock> operationLocks = LockUtil.createLazySegmentLock(64);

    public List<WorkspaceResp> listWorkspaces() {
        return list().stream().map(this::toResp).toList();
    }

    public WorkspaceResp saveWorkspace(String workspacePath) {
        return toResp(getOrCreate(workspacePath));
    }

    public Workspace getOrCreate(String workspacePath) {
        String normalizedPath = WorkspacePathUtil.normalizeExistingDirectory(workspacePath);
        String pathKey = WorkspacePathUtil.pathKey(normalizedPath);
        Lock lock = pathLocks.get(pathKey);
        lock.lock();
        try {
            Workspace existing = getByPathKey(pathKey);
            if (existing != null) return existing;

            Workspace workspace = new Workspace();
            workspace.setPath(normalizedPath);
            workspace.setPathKey(pathKey);
            try {
                save(workspace);
                return workspace;
            } catch (DuplicateKeyException e) {
                Workspace concurrent = getByPathKey(pathKey);
                if (concurrent != null) return concurrent;
                throw e;
            }
        } finally {
            lock.unlock();
        }
    }

    public WorkspaceDeleteResp deleteWorkspace(String workspaceId) {
        if (StrUtil.isBlank(workspaceId)) throw new ServiceException("工作区 ID 不能为空");
        return withOperationLock(workspaceId, () -> {
            List<Sessions> sessions = transactionTemplate.execute(_ -> deleteWorkspaceRecords(workspaceId));
            if (sessions == null) throw new ServiceException("删除工作区失败");
            for (Sessions session : sessions) cleanupSessionArtifacts(session);
            return new WorkspaceDeleteResp(sessions.size());
        });
    }

    public <T> T withOperationLock(String workspaceId, Supplier<T> action) {
        if (StrUtil.isBlank(workspaceId)) return action.get();
        Lock lock = operationLocks.get(workspaceId);
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }

    private List<Sessions> deleteWorkspaceRecords(String workspaceId) {
        Workspace workspace = getById(workspaceId);
        if (workspace == null) throw new ServiceException("工作区不存在");
        List<Sessions> sessions = sessionsMapper.selectList(Wrappers.<Sessions>lambdaQuery().eq(Sessions::getWorkspaceId, workspaceId));
        if (sessions.stream().anyMatch(session -> StrUtil.isNotBlank(session.getActiveTurnId()))) {
            throw new ServiceException("工作区存在运行中的会话，请先停止后再删除");
        }

        for (Sessions session : sessions) persistentChatMemoryStore.deleteMessages(session.getId());
        int deletedSessions = sessionsMapper.delete(Wrappers.<Sessions>lambdaQuery()
                .eq(Sessions::getWorkspaceId, workspaceId)
                .and(query -> query.isNull(Sessions::getActiveTurnId).or().eq(Sessions::getActiveTurnId, "")));
        if (deletedSessions != sessions.size()) throw new ServiceException("工作区会话运行状态已发生变化，请重试");
        if (!removeById(workspaceId)) throw new ServiceException("删除工作区失败");
        return sessions;
    }

    private Workspace getByPathKey(String pathKey) {
        return lambdaQuery().eq(Workspace::getPathKey, pathKey).one();
    }

    private WorkspaceResp toResp(Workspace workspace) {
        return new WorkspaceResp(workspace.getId(), WorkspacePathUtil.displayName(workspace.getPath()), workspace.getPath(),
                WorkspacePathUtil.isAvailable(workspace.getPath()), workspace.getCreatedAt());
    }

    private void cleanupSessionArtifacts(Sessions session) {
        if (StrUtil.isBlank(session.getTranscriptUri())) return;
        try {
            toolResultStore.deleteResults(session.getTranscriptUri());
        } catch (Exception e) {
            log.error("删除工作区会话工具结果失败 sessionId:{}", session.getId(), e);
        }
        try {
            sessionEventStore.deleteTranscript(session.getTranscriptUri());
        } catch (Exception e) {
            log.error("删除工作区会话事件文件失败 sessionId:{}", session.getId(), e);
        }
    }
}
