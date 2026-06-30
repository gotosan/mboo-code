package com.yu.mboocode.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.yu.mboocode.mapper.SessionsMapper;
import com.yu.mboocode.model.Sessions;
import org.springframework.stereotype.Service;

@Service
public class SessionService extends ServiceImpl<SessionsMapper, Sessions> {
    public void getOrNewSession() {

    }
}
