package com.yu.mboocode.agent.model;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 按模型保存的上下文窗口偏好。
 */
@Schema(description = "模型上下文窗口偏好")
@TableName("mboo_model_context_preference")
@Data
public class ModelContextPreference {
    @Schema(description = "供应商实际模型 ID")
    @TableId(value = "model_id", type = IdType.INPUT)
    private String modelId;

    @Schema(description = "用户保存的上下文窗口 Token 上限")
    private Long contextLimit;

    @Schema(description = "偏好创建时间")
    private String createdAt;

    @Schema(description = "偏好最近更新时间")
    private String updatedAt;
}
