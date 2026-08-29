package com.yu.mboocode.agent.tool.ask;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.agent.tool.ask.AskTool.AskAnswer;
import com.yu.mboocode.agent.tool.ask.AskTool.AskQuestion;
import com.yu.mboocode.common.exception.ServiceException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ExecutionException;

/** ask 活动状态、页面答案和取消/超时生命周期。 */
@Service
public class AskService {
    public static final String SKIPPED_TEXT = "用户跳过此问题";
    private static final long ASK_TIMEOUT_MINUTES = 10;
    private final Map<String, PendingAsk> active = new ConcurrentHashMap<>();

    public static List<AskQuestion> validateAndNormalize(List<AskQuestion> questions) {
        if (questions == null || questions.isEmpty() || questions.size() > 3) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "questions 必须包含 1 到 3 个问题页");
        List<AskQuestion> normalized = new ArrayList<>();
        for (AskQuestion page : questions) {
            if (page == null || StrUtil.isBlank(page.question()) || page.question().length() > 200) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "问题不能为空且不能超过 200 个字符");
            if (page.answers() == null || page.answers().isEmpty() || page.answers().size() > 3) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "每页必须包含 1 到 3 个选项");
            int recommended = 0;
            List<AskAnswer> options = new ArrayList<>();
            for (AskAnswer answer : page.answers()) {
                if (answer == null || StrUtil.isBlank(answer.text()) || answer.text().length() > 200) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "选项不能为空且不能超过 200 个字符");
                if (answer.description() != null && answer.description().length() > 500) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "选项描述不能超过 500 个字符");
                if (Boolean.TRUE.equals(answer.recommended())) recommended++;
                options.add(new AskAnswer(answer.text(), answer.description(), Boolean.TRUE.equals(answer.recommended())));
            }
            if (recommended != 1) throw new AskTool.AskToolException("ASK_INVALID_ARGUMENT", "每页必须恰有一个推荐选项");
            options.sort((left, right) -> Boolean.compare(!Boolean.TRUE.equals(left.recommended()), !Boolean.TRUE.equals(right.recommended())));
            normalized.add(new AskQuestion(page.question(), options));
        }
        return normalized;
    }

    public List<String> await(String sessionId, String turnId, String toolCallId, List<AskQuestion> questions) {
        String key = key(sessionId, toolCallId);
        PendingAsk pending = new PendingAsk(sessionId, turnId, toolCallId, questions);
        if (active.putIfAbsent(key, pending) != null) throw new AskTool.AskToolException("ASK_CONCURRENT_UNSUPPORTED", "当前会话已有待回答的问题");
        try {
            return pending.future.get(ASK_TIMEOUT_MINUTES, TimeUnit.MINUTES);
        } catch (TimeoutException e) {
            pending.expired = true;
            throw new AskTool.AskToolException("ASK_EXPIRED", "提问等待超过 10 分钟，已失效", e);
        } catch (CancellationException e) {
            throw new AskTool.AskToolException("ASK_CANCELLED", "提问已取消", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AskTool.AskToolException("ASK_CANCELLED", "提问等待被中断", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof AskTool.AskToolException askError) throw askError;
            throw new AskTool.AskToolException("ASK_FAILED", "提问处理失败", cause);
        } finally {
            active.remove(key, pending);
        }
    }

    public void submit(String sessionId, String askId, int pageIndex, String action, String text, String actionId) {
        if (StrUtil.isBlank(actionId)) throw new ServiceException("actionId 不能为空");
        PendingAsk pending = active.get(key(sessionId, askId));
        if (pending == null) throw new AskRequestException(410, "提问请求已失效");
        synchronized (pending) {
            if (pending.expired || pending.completed || pending.cancelled) throw new AskRequestException(409, "提问已处理或已失效");
            if (pageIndex < 0 || pageIndex >= pending.questions.size()) throw new ServiceException("pageIndex 无效");
            String previousAction = pending.actionIds.get(pageIndex);
            if (actionId.equals(previousAction)) return;
            int firstUnanswered = firstUnanswered(pending.answers);
            if (pageIndex > firstUnanswered) throw new AskRequestException(409, "请按问题页顺序提交");
            String answer = "ANSWER".equals(action) ? StrUtil.trimToNull(text) : "SKIP".equals(action) ? AskService.SKIPPED_TEXT : null;
            if (answer == null) throw new ServiceException("答案不能为空，action 必须为 ANSWER 或 SKIP");
            if ("ANSWER".equals(action) && answer.length() > 2000) throw new ServiceException("自填答案不能超过 2000 个字符");
            pending.answers.set(pageIndex, answer);
            pending.actionIds.put(pageIndex, actionId);
            if (firstUnanswered(pending.answers) < 0) {
                pending.completed = true;
                pending.future.complete(List.copyOf(pending.answers));
            }
        }
    }

    public void cancelTurn(String sessionId, String turnId) {
        active.values().stream().filter(item -> item.sessionId.equals(sessionId) && item.turnId.equals(turnId)).forEach(item -> {
            synchronized (item) {
                item.cancelled = true;
                item.future.cancel(false);
            }
        });
    }

    private int firstUnanswered(List<String> answers) {
        for (int i = 0; i < answers.size(); i++) if (answers.get(i) == null) return i;
        return -1;
    }

    private String key(String sessionId, String askId) {
        if (StrUtil.hasBlank(sessionId, askId)) throw new ServiceException("提问标识参数不完整");
        return sessionId + ":" + askId;
    }

    public static class AskRequestException extends ServiceException {
        private final int status;
        public AskRequestException(int status, String message) { super(message); this.status = status; }
        public int status() { return status; }
    }

    private static final class PendingAsk {
        private final String sessionId;
        private final String turnId;
        private final String toolCallId;
        private final List<AskQuestion> questions;
        private final List<String> answers;
        private final Map<Integer, String> actionIds = new ConcurrentHashMap<>();
        private final CompletableFuture<List<String>> future = new CompletableFuture<>();
        private boolean completed;
        private boolean cancelled;
        private boolean expired;
        private PendingAsk(String sessionId, String turnId, String toolCallId, List<AskQuestion> questions) {
            this.sessionId = sessionId; this.turnId = turnId; this.toolCallId = toolCallId; this.questions = List.copyOf(questions);
            this.answers = new ArrayList<>(questions.stream().map(_ -> (String) null).toList());
        }
    }
}
