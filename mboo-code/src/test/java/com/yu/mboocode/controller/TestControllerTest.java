package com.yu.mboocode.controller;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.client.RestClient;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class TestControllerTest {

    @LocalServerPort
    private int port;

    @Test
    void shouldReturnTestResponse() {
        Map response = RestClient.builder()
            .baseUrl("http://localhost:" + port)
            .build()
            .get()
            .uri("/test?name=张三&times=2&debug=true")
            .retrieve()
            .body(Map.class);

        assertThat(response).isNotNull();
        assertThat(response.get("code")).isEqualTo(200);
        assertThat(response.get("message")).isEqualTo("测试接口调用成功");
        assertThat(response.get("data")).isEqualTo("hello mboo-code, 我是张三！我是张三！");
        assertThat(response.get("requestId")).isEqualTo("demo-张三-2");
        assertThat(response.get("debug")).isEqualTo(true);
    }
}
