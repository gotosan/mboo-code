package com.yu.mboocode.session.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.session.mapper.SessionEventStore;
import com.yu.mboocode.session.mapper.SessionsMapper;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.util.DateTimeUtil;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Objects;

@Service
public class SessionService extends ServiceImpl<SessionsMapper, Sessions> {
    @Resource
    private SessionEventStore sessionEventStore;

    @Transactional
    public Sessions getActiveOrCreateSession(String sessionId, String userMessage) {
        if (StrUtil.isNotBlank(sessionId)) {
            return getActiveSession(sessionId);
        }
        return createSession(userMessage);
    }

    @Transactional
    public Sessions createSession(String userMessage) {
        Sessions session = new Sessions();
        session.setTitle(toTitle(userMessage)); //todo 后续看看用大模型的回答
        session.setStatus(Sessions.StatusEnum.ACTIVE.getCode());
        session.setMetadataJson("{}");
        save(session);

        session.setTranscriptUri(sessionEventStore.newTranscriptUri(session.getId()));
        updateById(session);
        return session;
    }

    // 根据 id 获取当前活跃的会话
    public Sessions getActiveSession(String sessionId) {
        Sessions session = getById(sessionId);
        if (Objects.equals(session.getStatus(), Sessions.StatusEnum.ACTIVE.getCode())) {
            return session;
        } else {
            return null;
        }
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
    public void clearActiveTurn(String sessionId) {
        lambdaUpdate()
                .eq(Sessions::getId, sessionId)
                .set(Sessions::getActiveTurnId, null)
                .set(Sessions::getUpdatedAt, DateTimeUtil.now())
                .update();
    }

    private String toTitle(String userMessage) {
        if (!StringUtils.hasText(userMessage)) {
            return "新会话";
        }
        String trimmed = userMessage.strip();
        if (trimmed.length() <= 32) {
            return trimmed;
        }
        return trimmed.substring(0, 32);
    }
}
