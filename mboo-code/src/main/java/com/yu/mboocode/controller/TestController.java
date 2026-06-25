package com.yu.mboocode.controller;

import com.yu.mboocode.model.TestResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "测试接口", description = "用于演示 Knife4j / OpenAPI 文档效果的示例接口")
@RestController
@RequestMapping("/test")
public class TestController {
    @Operation(
            summary = "测试问候接口",
            description = "根据传入参数生成测试响应，演示查询参数、默认值、返回模型和示例返回值。"
    )
    @GetMapping
    public TestResponse test(
            @Parameter(description = "姓名", example = "张三", required = true)
            String name,
            @Parameter(description = "重复次数，范围建议 1-5", example = "2")
            int times,
            @Parameter(description = "是否返回调试标记", example = "true")
            boolean debug
    ) {
        int safeTimes = Math.max(1, Math.min(times, 5));
        String messageBody = ("我是" + name + "！").repeat(safeTimes);

        return new TestResponse(
                200,
                "测试接口调用成功",
                "hello mboo-code, " + messageBody,
                "demo-" + name + "-" + safeTimes,
                debug
        );
    }
}
