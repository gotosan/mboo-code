package com.yu.mboocode.llm.tool.command;

public interface ProcessTreeTerminator {
    boolean terminate(Process process, long graceMs);
}
