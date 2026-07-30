package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.tool.command.CommandPermissionRule.CommandAction;

public record CommandRuleMatch(String pattern, CommandAction action, boolean wildcard) {
}
