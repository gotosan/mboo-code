package com.yu.mboocode.common.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum SSEEvent {
    SESSION("session"), // 会话事件
    ;
    private final String code;
}
