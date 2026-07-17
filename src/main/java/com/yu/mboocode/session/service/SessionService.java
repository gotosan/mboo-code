package com.yu.mboocode.session.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.session.mapper.SessionsMapper;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.util.DateTimeUtil;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Objects;

@Service
public class SessionService extends ServiceImpl<SessionsMapper, Sessions> {
    @Resource
    private SessionEventStore sessionEventStore;
    @Transactional
    public Sessions getActiveOrCreateSession(String sessionId) {
        if (StrUtil.isNotBlank(sessionId)) {
            return getActiveSession(sessionId);
        }
        return createSession();
    }

    @Transactional
    public Sessions createSession() {
        Sessions session = new Sessions();
        session.setTitle("新会话"); //todo 后续看看用大模型的回答
        session.setStatus(Sessions.StatusEnum.ACTIVE.getCode());
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

    public List<SessionEvent> readSessionEvents(String sessionId) {
        Sessions session = getSession(sessionId);
        if (StrUtil.isBlank(session.getTranscriptUri())) {
            return Collections.emptyList();
        }
        return sessionEventStore.readSession(session.getTranscriptUri());
    }

    @Transactional
    public Sessions updateTitle(String sessionId, String title) {
        Sessions session = getSession(sessionId);
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
        // 归档逻辑后续实现，当前仅保留接口并校验会话存在。
        Sessions session = getSession(sessionId);
        return session;
    }

    @Transactional
    public void deleteSession(String sessionId) {
        // 删除逻辑后续实现，当前仅保留接口并校验会话存在。
        getSession(sessionId);
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
}
