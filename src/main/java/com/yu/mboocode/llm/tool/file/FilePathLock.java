package com.yu.mboocode.llm.tool.file;

import cn.hutool.core.thread.lock.LockUtil;
import cn.hutool.core.thread.lock.SegmentLock;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.concurrent.locks.Lock;

@Component
public class FilePathLock {
    private final SegmentLock<Lock> locks = LockUtil.createLazySegmentLock(128);

    public Lock get(Path path) {
        return locks.get(path.toAbsolutePath().normalize().toString());
    }
}
