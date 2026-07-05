package com.yu.mboocode.session.model;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.Getter;

/**
 * 会话信息。
 */
@Schema(description = "会话信息")
@TableName(value = "mboo_sessions")
@Data
public class Sessions {
    @Schema(description = "会话 ID")
    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    @Schema(description = "会话标题")
    private String title;

    @Schema(description = "会话状态：`active` 活跃、`archived` 已归档、`deleted` 已软删除")
    private String status;

    @Schema(description = "会话文件路径或相对 URI")
    private String transcriptUri;

    @Schema(description = "当前运行中的 turn ID")
    private String activeTurnId;

    @Schema(description = "会话创建时间")
    @TableField(fill = FieldFill.INSERT)
    private String createdAt;

    @Schema(description = "会话最近更新时间")
    private String updatedAt;

    @Schema(description = "会话归档时间")
    private String archivedAt;

    @Schema(description = "会话删除时间")
    private String deletedAt;

    @Schema(description = "会话扩展元数据，JSON 字符串，例如工作区路径、UI 设置等")
    private String metadataJson;

    @AllArgsConstructor
    @Getter
    public enum StatusEnum {
        ACTIVE("active"), //活跃
        ARCHIVED("archived"), //归档
        DELETED("deleted") //删除,
        ;

        private final String code;
    }
}
