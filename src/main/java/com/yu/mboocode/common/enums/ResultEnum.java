package com.yu.mboocode.common.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum ResultEnum {
    SUCCESS(200, "成功"),
    FAILED(500, "服务器内部错误"),
    ;

    private final Integer code;
    private final String msg;
}
