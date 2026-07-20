package com.yu.mboocode.agent.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.service.PersistentChatMemoryStore;
import com.yu.mboocode.agent.mapper.SessionsMapper;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.util.CommonUtil;
import com.yu.mboocode.util.DateTimeUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.InvalidPathException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

@Service
@Slf4j
public class SessionService extends ServiceImpl<SessionsMapper, Sessions> {
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private PersistentChatMemoryStore persistentChatMemoryStore;

    @Transactional
    public Sessions getActiveOrCreateSession(String sessionId, String workspacePath) {
        if (StrUtil.isNotBlank(sessionId)) {
            return getActiveSession(sessionId);
        }
        return createSession(workspacePath);
    }

    @Transactional
    public Sessions createSession(String workspacePath) {
        Sessions session = new Sessions();
        session.setTitle("新会话"); //todo 后续看看用大模型的回答
        session.setStatus(Sessions.StatusEnum.ACTIVE.getCode());
        String resolvedWorkspacePath = StrUtil.isNotBlank(workspacePath) ? normalizeWorkspacePath(workspacePath) : createDefaultWorkspace(session.getId(), LocalDate.now());
        session.setWorkspacePath(resolvedWorkspacePath);
        session.setMetadataJson("{}");
        save(session);

        session.setTranscriptUri(sessionEventStore.newTranscriptUri(session.getId()));
        updateById(session);
        return session;
    }

    // 根据 id 获取当前活跃的会话
    public Sessions getActiveSession(String sessionId) {
        Sessions session = getSession(sessionId);
        if (Objects.equals(session.getStatus(), Sessions.StatusEnum.ACTIVE.getCode())) {
            return session;
        }
        throw new ServiceException("当前会话不可继续使用");
    }

    public Sessions getSession(String sessionId) {
        if (StrUtil.isBlank(sessionId)) {
            throw new ServiceException("会话 ID 不能为空");
        }
        Sessions session = getById(sessionId);
        if (session == null) {
            throw new ServiceException("会话不存在");
        }
        return session;
    }

    public List<Sessions> listActiveSessions() {
        return lambdaQuery()
                .eq(Sessions::getStatus, Sessions.StatusEnum.ACTIVE.getCode())
                .orderByDesc(Sessions::getUpdatedAt)
                .list();
    }

    public List<Sessions> listArchivedSessions() {
        return lambdaQuery()
                .eq(Sessions::getStatus, Sessions.StatusEnum.ARCHIVED.getCode())
                .orderByDesc(Sessions::getArchivedAt)
                .list();
    }

    public List<SessionEvent> readSessionEvents(String sessionId) {
        Sessions session = getSession(sessionId);
        if (StrUtil.isBlank(session.getTranscriptUri())) {
            return Collections.emptyList();
        }
        return sessionEventStore.readSession(session.getTranscriptUri());
    }

    @Transactional
    public Sessions updateTitle(String sessionId, String title) {
        Sessions session = getActiveSession(sessionId);
        String trimmedTitle = StrUtil.trim(title);
        if (StrUtil.isBlank(trimmedTitle)) {
            throw new ServiceException("会话标题不能为空");
        }
        if (trimmedTitle.length() > 80) {
            throw new ServiceException("会话标题不能超过 80 个字符");
        }

        session.setTitle(trimmedTitle);
        updateById(session);
        return getSession(sessionId);
    }

    @Transactional
    public Sessions archiveSession(String sessionId) {
        Sessions session = getSession(sessionId);
        if (!Objects.equals(session.getStatus(), Sessions.StatusEnum.ACTIVE.getCode())) {
            throw new ServiceException("仅活跃会话可归档");
        }
        if (StrUtil.isNotBlank(session.getActiveTurnId())) {
            throw new ServiceException("正在会话中，不能归档");
        }

        String now = DateTimeUtil.now();
        boolean updated = lambdaUpdate()
                .eq(Sessions::getId, sessionId)
                .eq(Sessions::getStatus, Sessions.StatusEnum.ACTIVE.getCode())
                .isNull(Sessions::getActiveTurnId)
                .set(Sessions::getStatus, Sessions.StatusEnum.ARCHIVED.getCode())
                .set(Sessions::getArchivedAt, now)
                .set(Sessions::getUpdatedAt, now)
                .update();
        if (!updated) {
            Sessions latest = getSession(sessionId);
            if (StrUtil.isNotBlank(latest.getActiveTurnId())) {
                throw new ServiceException("正在会话中，不能归档");
            }
            throw new ServiceException("仅活跃会话可归档");
        }
        return getSession(sessionId);
    }

    @Transactional
    public Sessions unarchiveSession(String sessionId) {
        Sessions session = getSession(sessionId);
        if (!Objects.equals(session.getStatus(), Sessions.StatusEnum.ARCHIVED.getCode())) {
            throw new ServiceException("仅已归档会话可取消归档");
        }

        String now = DateTimeUtil.now();
        boolean updated = lambdaUpdate()
                .eq(Sessions::getId, sessionId)
                .eq(Sessions::getStatus, Sessions.StatusEnum.ARCHIVED.getCode())
                .set(Sessions::getStatus, Sessions.StatusEnum.ACTIVE.getCode())
                .set(Sessions::getArchivedAt, null)
                .set(Sessions::getUpdatedAt, now)
                .update();
        if (!updated) {
            throw new ServiceException("仅已归档会话可取消归档");
        }
        return getSession(sessionId);
    }

    @Transactional
    public void deleteSession(String sessionId) {
        Sessions session = getSession(sessionId);
        if (!Objects.equals(session.getStatus(), Sessions.StatusEnum.ARCHIVED.getCode())) {
            throw new ServiceException("仅已归档会话可删除");
        }

        if (StrUtil.isNotBlank(session.getTranscriptUri())) {
            sessionEventStore.deleteTranscript(session.getTranscriptUri());
        }
        persistentChatMemoryStore.deleteMessages(sessionId);
        removeById(sessionId);
    }

    public boolean updateActiveTurn(String sessionId, String turnId) {
        return lambdaUpdate()
                .eq(Sessions::getId, sessionId)
                .isNull(Sessions::getActiveTurnId)
                .set(Sessions::getActiveTurnId, turnId)
                .set(Sessions::getUpdatedAt, DateTimeUtil.now())
                .update();
    }

    // 清理当前活跃轮次
    public void clearActiveTurn(String sessionId, String activeTurnId) {
        lambdaUpdate()
                .eq(Sessions::getId, sessionId)
                .eq(Sessions::getActiveTurnId, activeTurnId)
                .set(Sessions::getActiveTurnId, null)
                .set(Sessions::getUpdatedAt, DateTimeUtil.now())
                .update();
    }

    private String createDefaultWorkspace(String sessionId, LocalDate date) {
        try {
            Path workspacePath = Path.of(CommonUtil.getAppDataDir(), "workspaces", date.toString(), sessionId).toAbsolutePath().normalize();
            Files.createDirectories(workspacePath);
            return workspacePath.toString();
        } catch (IOException | InvalidPathException e) {
            log.error("创建默认工作区失败 sessionId:{}", sessionId, e);
            throw new ServiceException("创建默认工作区失败");
        }
    }

    private String normalizeWorkspacePath(String workspacePath) {
        try {
            return Path.of(workspacePath).toAbsolutePath().normalize().toString();
        } catch (InvalidPathException e) {
            throw new ServiceException("工作区路径格式错误");
        }
    }
}
