package com.yu.mboocode.agent.tool.command;

public interface ProcessTreeTerminator {
    boolean terminate(Process process, long graceMs);
}
