package com.yu.mboocode.agent.tool.command;

import com.yu.mboocode.agent.tool.command.ReadOnlyCommandClassifier.CommandAnalysis;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public class PosixCommandAnalyzer {
    public CommandAnalysis analyze(String command) {
        List<String> tokens = new ArrayList<>();
        StringBuilder token = new StringBuilder();
        boolean singleQuoted = false;
        boolean doubleQuoted = false;
        boolean escaped = false;
        boolean tokenStarted = false;
        for (int i = 0; i < command.length(); i++) {
            char current = command.charAt(i);
            if (escaped) {
                token.append(current);
                escaped = false;
                tokenStarted = true;
                continue;
            }
            if (current == '\\' && !singleQuoted) {
                escaped = true;
                tokenStarted = true;
                continue;
            }
            if (current == '\'' && !doubleQuoted) {
                singleQuoted = !singleQuoted;
                tokenStarted = true;
                continue;
            }
            if (current == '"' && !singleQuoted) {
                doubleQuoted = !doubleQuoted;
                tokenStarted = true;
                continue;
            }
            if (!singleQuoted && (current == '$' || current == '`')) return CommandAnalysis.unsafe();
            if (!singleQuoted && !doubleQuoted && (current == '*' || current == '?' || current == '[' || current == ']' || current == '~' || current == '{' || current == '}')) {
                return CommandAnalysis.unsafe();
            }
            if (!singleQuoted && !doubleQuoted && isCompound(current)) return CommandAnalysis.unsafe();
            if (!singleQuoted && !doubleQuoted && Character.isWhitespace(current)) {
                if (current == '\r' || current == '\n') return CommandAnalysis.unsafe();
                if (tokenStarted) {
                    tokens.add(token.toString());
                    token.setLength(0);
                    tokenStarted = false;
                }
                continue;
            }
            token.append(current);
            tokenStarted = true;
        }
        if (escaped || singleQuoted || doubleQuoted) return CommandAnalysis.unsafe();
        if (tokenStarted) tokens.add(token.toString());
        return tokens.isEmpty() ? CommandAnalysis.unsafe() : new CommandAnalysis(true, false, tokens);
    }

    private boolean isCompound(char value) {
        return value == '|' || value == '&' || value == ';' || value == '<' || value == '>' || value == '(' || value == ')';
    }
}
