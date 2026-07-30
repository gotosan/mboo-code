package com.yu.mboocode.llm.tool.command;

public record CommandPermissionRule(String pattern, CommandAction action) {
    public CommandPermissionRule {
        if (pattern == null || pattern.isBlank()) throw new IllegalArgumentException("命令规则 pattern 不能为空");
        if (action == null) throw new IllegalArgumentException("命令规则 action 不能为空");
    }

    public enum CommandAction {
        ALLOW,
        ASK,
        DENY
    }
}
