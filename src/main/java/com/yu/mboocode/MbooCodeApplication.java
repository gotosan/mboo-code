package com.yu.mboocode;

import com.yu.mboocode.util.CommonUtil;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootApplication
@MapperScan(basePackages = {"com.yu.mboocode.*.mapper"})
public class MbooCodeApplication {
    static void main(String[] args) {
        createMbooHomeDirectory();
        SpringApplication.run(MbooCodeApplication.class, args);
    }

    private static void createMbooHomeDirectory() {
        Path dir = Path.of(CommonUtil.getAppDataDir());
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new IllegalStateException("创建 .mboo 目录失败: " + dir, e);
        }
    }
}
