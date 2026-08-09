package com.yu.mboocode.agent.model;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 保存工作区。
 */
@Schema(description = "保存工作区")
@TableName(value = "mboo_workspaces")
@Data
public class Workspace {
    @Schema(description = "工作区 ID")
    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    @Schema(description = "规范化后的真实绝对路径")
    private String path;

    @Schema(description = "按当前平台路径语义生成的唯一比较键")
    private String pathKey;

    @Schema(description = "工作区首次保存时间")
    @TableField(fill = FieldFill.INSERT)
    private String createdAt;
}
