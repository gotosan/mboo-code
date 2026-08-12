package com.yu.mboocode.agent.enums;

import com.yu.mboocode.common.enums.CodeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 执行 turn 操作类型。
 *
 * <p>执行 turn 由 TurnService.turn 创建，负责 session 级互斥与事件生命周期；
 * 聊天和主动压缩都会创建执行 turn，与 ChatMemory 对话 turn 是两个概念。</p>
 */
@Schema(description = "执行 turn 操作类型")
@Getter
@AllArgsConstructor
public enum TurnOperationType implements CodeEnum {
    CHAT("chat"), //聊天
    CONTEXT_COMPRESSION("context_compression"), //主动上下文压缩
    ;

    private final String code;
}
