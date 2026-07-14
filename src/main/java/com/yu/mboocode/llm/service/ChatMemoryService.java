package com.yu.mboocode.llm.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.llm.mapper.ChatMemoryMapper;
import com.yu.mboocode.llm.model.ChatMemory;
import org.springframework.stereotype.Service;

@Service
public class ChatMemoryService extends ServiceImpl<ChatMemoryMapper, ChatMemory> {
}
