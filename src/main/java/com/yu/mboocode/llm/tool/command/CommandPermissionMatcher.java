package com.yu.mboocode.llm.tool.command;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

@Component
public class CommandPermissionMatcher {
    private static final List<CommandPermissionRule> COMMAND_RULES = List.of();
    private final List<CompiledRule> rules;

    public CommandPermissionMatcher() {
        List<CompiledRule> compiled = new ArrayList<>();
        for (CommandPermissionRule rule : COMMAND_RULES) compiled.add(new CompiledRule(rule, Pattern.compile(toRegex(rule.pattern()))));
        this.rules = List.copyOf(compiled);
    }

    public Optional<CommandRuleMatch> match(String command) {
        CommandRuleMatch last = null;
        for (CompiledRule rule : rules) {
            if (rule.pattern().matcher(command).matches()) {
                String pattern = rule.rule().pattern();
                last = new CommandRuleMatch(rule.rule().action(), pattern.indexOf('*') >= 0 || pattern.indexOf('?') >= 0);
            }
        }
        return Optional.ofNullable(last);
    }

    private String toRegex(String glob) {
        StringBuilder regex = new StringBuilder("^");
        for (int i = 0; i < glob.length(); i++) {
            char current = glob.charAt(i);
            if (current == '*') regex.append(".*");
            else if (current == '?') regex.append('.');
            else regex.append(Pattern.quote(String.valueOf(current)));
        }
        return regex.append('$').toString();
    }

    private record CompiledRule(CommandPermissionRule rule, Pattern pattern) {
    }

    private record CommandPermissionRule(String pattern, CommandAction action) {
        private CommandPermissionRule {
            if (pattern == null || pattern.isBlank()) throw new IllegalArgumentException("命令规则 pattern 不能为空");
            if (action == null) throw new IllegalArgumentException("命令规则 action 不能为空");
        }
    }

    public record CommandRuleMatch(CommandAction action, boolean wildcard) {
    }

    public enum CommandAction {
        ALLOW,
        ASK,
        DENY
    }
}
