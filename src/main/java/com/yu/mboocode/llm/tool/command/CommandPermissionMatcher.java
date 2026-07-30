package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.tool.command.CommandPermissionRule.CommandAction;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

@Component
public class CommandPermissionMatcher {
    private static final CommandAction DEFAULT_ACTION = CommandAction.ASK;
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
                last = new CommandRuleMatch(pattern, rule.rule().action(), pattern.indexOf('*') >= 0 || pattern.indexOf('?') >= 0);
            }
        }
        return Optional.ofNullable(last);
    }

    public CommandAction defaultAction() {
        return DEFAULT_ACTION;
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
}
