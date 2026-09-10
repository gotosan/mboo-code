package com.yu.mboocode.agent.subagent;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.agent.mapper.SubagentRunMapper;
import com.yu.mboocode.common.util.DateTimeUtil;
import jakarta.annotation.Resource;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class SubagentRunStore extends ServiceImpl<SubagentRunMapper, SubagentRun> {
    @Resource
    private JdbcTemplate jdbcTemplate;

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterrupted() {
        jdbcTemplate.update("UPDATE mboo_subagent_runs SET status = 'INTERRUPTED', error_code = 'SUBAGENT_INTERRUPTED', error_message = '应用重启，清理状态未知，未自动重放', version = version + 1, updated_at = ?, finished_at = ? WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", DateTimeUtil.now(), DateTimeUtil.now());
        jdbcTemplate.update("UPDATE mboo_sessions SET active_turn_id = NULL WHERE id IN (SELECT agent_id FROM mboo_subagent_runs WHERE status = 'INTERRUPTED')");
    }

    public List<SubagentRun> byParent(String sessionId, String turnId) {
        return lambdaQuery().eq(SubagentRun::getParentSessionId, sessionId).eq(turnId != null, SubagentRun::getParentTurnId, turnId).orderByAsc(SubagentRun::getCreatedAt).list();
    }
}
