package com.yu.mboocode.model;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "测试接口响应")
public record TestResponse(
    @Schema(description = "业务状态码", example = "200")
    int code,
    @Schema(description = "响应消息", example = "测试接口调用成功")
    String message,
    @Schema(description = "响应数据", example = "hello mboo-code, 我是张三！张三！")
    String data,
    @Schema(description = "请求标识", example = "demo-zhangsan-2")
    String requestId,
    @Schema(description = "是否为调试模式", example = "true")
    boolean debug
) {
}
