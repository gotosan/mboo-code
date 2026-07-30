package com.yu.mboocode.llm.tool.command;

import java.util.List;

public record CommandAnalysis(boolean parsed, boolean compound, List<String> tokens) {
    public CommandAnalysis {
        tokens = List.copyOf(tokens);
    }

    public static CommandAnalysis unsafe() {
        return new CommandAnalysis(false, true, List.of());
    }
}
