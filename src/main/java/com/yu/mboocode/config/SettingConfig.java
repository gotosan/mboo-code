package com.yu.mboocode.config;

import jakarta.annotation.Resource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SettingConfig {
    @Resource
    private SettingFileStore settingFileStore;

    @Bean
    public Setting setting() {
        return settingFileStore.readEffective();
    }
}
