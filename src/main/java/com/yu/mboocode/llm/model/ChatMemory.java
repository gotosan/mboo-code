package com.yu.mboocode.llm.model;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 模型会话上下文。
 */
@Schema(description = "模型会话上下文")
@TableName(value = "mboo_chat_memory")
@Data
public class ChatMemory {
    @Schema(description = "会话 ID")
    @TableId(value = "memory_id", type = IdType.INPUT)
    private String memoryId;

    @Schema(description = "模型使用的近期聊天消息 JSON")
    private String messagesJson;

    @Schema(description = "早期会话历史摘要")
    private String summaryText;

    @Schema(description = "会话上下文最近更新时间")
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private String updatedAt;
}
