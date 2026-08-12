package com.yu.mboocode.common.enums;

import com.alibaba.fastjson2.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonValue;

public interface CodeEnum {
    String getCode();

    @JsonValue
    @JSONField(value = true)
    default String jsonValue() {
        return getCode();
    }
}