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
 import com.yu.mboocode.session.payload.AssistantMessagePayload;
import com.yu.mboocode.session.payload.SessionEventPayload;
import com.yu.mboocode.session.payload.UserMessagePayload;
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
import java.util.Map;
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
            SessionEventPayload payload
    ) {
        Path path = resolveTranscriptPath(transcriptUri);
        try {
            Files.createDirectories(path.getParent());
            repairJsonlLastLine(path);
            type.validatePayload(payload);

            SessionEvent event = SessionEvent.builder()
                    .eventId(IdUtil.getSnowflakeNextIdStr())
                    .sessionId(sessionId)
                    .turnId(turnId)
                    .type(type)
                    .source(source)
                    .createdAt(DateTimeUtil.now())
                    .payload(payload)
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
                    events.add(parseEventLine(line));
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
                            case SessionEventType.USER_MESSAGE -> {
                                UserMessagePayload payload = (UserMessagePayload) event.getPayload();
                                yield new ConversationMessage("user", payload.getText());
                            }
                            case SessionEventType.ASSISTANT_MESSAGE -> {
                                AssistantMessagePayload payload = (AssistantMessagePayload) event.getPayload();
                                if (!Objects.equals(payload.getState(), "completed")) {
                                    yield null;
                                }
                                yield new ConversationMessage("assistant", payload.getText());
                            }
                            default -> null;
                        })
                .filter(Objects::nonNull).toList();
    }

    /**
     * 先读取事件类型，再用类型绑定的 payload 类反序列化事件主体。
     */
    @SuppressWarnings("unchecked")
    private SessionEvent parseEventLine(String line) {
        JSONObject json = JSON.parseObject(line);
        String typeName = json.getString("type");
        if (typeName == null) {
            throw new JSONException("事件类型不能为空");
        }

        SessionEventType type;
        try {
            type = SessionEventType.valueOf(typeName);
        } catch (IllegalArgumentException e) {
            throw new JSONException("未知事件类型: " + typeName);
        }

        SessionEventSource source;
        try {
            source = SessionEventSource.valueOf(json.getString("source"));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new JSONException("未知事件来源: " + json.getString("source"));
        }

        JSONObject payloadJson = json.getJSONObject("payload");
        SessionEventPayload payload = payloadJson == null
                ? JSON.parseObject("{}", type.getPayloadClass())
                : payloadJson.toJavaObject(type.getPayloadClass());
        try {
            type.validatePayload(payload);
        } catch (IllegalArgumentException e) {
            throw new JSONException(e.getMessage());
        }

        Map<String, Object> meta = json.getObject("meta", Map.class);
        return SessionEvent.builder()
                .eventId(json.getString("eventId"))
                .sessionId(json.getString("sessionId"))
                .turnId(json.getString("turnId"))
                .type(type)
                .source(source)
                .createdAt(json.getString("createdAt"))
                .payload(payload)
                .meta(meta == null ? Collections.emptyMap() : meta)
                .build();
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
            parseEventLine(lastLine);
        } catch (JSONException e) {
            List<String> validLines = lines.subList(0, lines.size() - 1);
            Files.write(path, validLines, StandardCharsets.UTF_8);
        }
    }
}
