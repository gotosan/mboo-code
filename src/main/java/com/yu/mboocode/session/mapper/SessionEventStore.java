package com.yu.mboocode.session.mapper;

import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONException;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.session.dto.ConversationMessage;
import com.yu.mboocode.session.enums.SessionEventSource;
import com.yu.mboocode.session.enums.SessionEventType;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.util.CommonUtil;
import com.yu.mboocode.util.DateTimeUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * 负责会话 JSONL 事件日志的追加写入和顺序回放。
 */
@Component
@Slf4j
public class SessionEventStore {
    /**
     * 为新会话生成相对于应用数据目录的主事件日志路径。
     */
    public String newTranscriptUri(String sessionId) {
        return "sessions" + "/" + sessionId + "/session.jsonl";
    }

    /**
     * 将数据库中保存的 transcriptUri 解析成实际文件路径。
     */
    public Path resolveTranscriptPath(String transcriptUri) {
        Path path = Path.of(transcriptUri);
        if (path.isAbsolute()) { //判断是绝对路径，直接返回
            return path;
        }
        return Path.of(CommonUtil.getAppDataDir()).resolve(path).normalize();
    }

    /**
     * 追加一条完整事件，事件 ID 使用雪花 ID。
     */
    public synchronized SessionEvent appendSession(
            String transcriptUri,
            String sessionId,
            String turnId,
            SessionEventType type,
            SessionEventSource source,
            JSONObject payload
    ) {
        Path path = resolveTranscriptPath(transcriptUri);
        try {
            Files.createDirectories(path.getParent());
            repairJsonlLastLine(path);

            SessionEvent event = SessionEvent.builder()
                    .eventId(IdUtil.getSnowflakeNextIdStr())
                    .sessionId(sessionId)
                    .turnId(turnId)
                    .type(type)
                    .source(source)
                    .createdAt(DateTimeUtil.now())
                    .payload(payload == null ? new JSONObject() : payload)
                    .meta(Collections.emptyMap())
                    .build();

            try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
                writer.write(JSON.toJSONString(event));
                writer.newLine();
            }
            return event;
        } catch (IOException e) {
            log.error("写入会话事件失败 path:{}", path, e);
            throw new ServiceException("写入会话事件失败");
        }
    }

    /**
     * 按文件行顺序读取事件
     */
    public List<SessionEvent> readSession(String transcriptUri) {
        Path path = resolveTranscriptPath(transcriptUri);
        if (Files.notExists(path)) {
            return Collections.emptyList();
        }

        List<SessionEvent> events = new ArrayList<>();
        try {
            List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.isBlank()) {
                    continue;
                }
                try {
                    events.add(JSON.parseObject(line, SessionEvent.class));
                } catch (JSONException e) {
                    if (i == lines.size() - 1) { //最后一行错误不处理，后续写入会处理掉
                        break;
                    }
                    throw e;
                }
            }
            return events;
        } catch (IOException e) {
            log.error("读取会话事件失败 path:{}", path, e);
            throw new ServiceException("读取会话失败");
        } catch (JSONException e) {
            log.error("读取会话事件失败 path:{}", path, e);
            throw new ServiceException("会话 JSON 格式错误");
        }
    }

    /**
     * 从事件日志中还原普通聊天历史，用于临时构建多轮模型输入。
     */
    public List<ConversationMessage> replayConversation(String transcriptUri) {
        return readSession(transcriptUri).stream().filter(event -> event.getPayload() != null).map(event ->
                        switch (event.getType()) {
                            case SessionEventType.USER_MESSAGE ->
                                    new ConversationMessage("user", event.getPayload().getString("text"));
                            case SessionEventType.ASSISTANT_MESSAGE -> {
                                if (!Objects.equals(event.getPayload().getString("state"), "completed")) {
                                    yield null;
                                }
                                yield new ConversationMessage("assistant", event.getPayload().getString("text"));
                            }
                            default -> null;
                        })
                .filter(Objects::nonNull).toList();
    }

    /**
     * 快速构造事件 payload，避免调用方重复创建 JSONObject。
     */
    public JSONObject payload(Object... keyValues) {
        JSONObject payload = new JSONObject();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            payload.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return payload;
    }

    // 修复 JSONL 日志文件最后一行可能的损坏
    private void repairJsonlLastLine(Path path) throws IOException {
        if (Files.notExists(path)) {
            return;
        }

        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        if (lines.isEmpty()) {
            return;
        }

        String lastLine = lines.getLast();
        if (lastLine.isBlank()) {
            return;
        }

        try {
            JSON.parseObject(lastLine, SessionEvent.class);
        } catch (JSONException e) {
            List<String> validLines = lines.subList(0, lines.size() - 1);
            Files.write(path, validLines, StandardCharsets.UTF_8);
        }
    }
}
