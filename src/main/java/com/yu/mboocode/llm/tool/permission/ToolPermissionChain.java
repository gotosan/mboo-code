package com.yu.mboocode.llm.tool.permission;

import java.util.List;

public record ToolPermissionChain(List<PermissionRequirement> requirements) {
    public ToolPermissionChain {
        requirements = List.copyOf(requirements);
    }

    public boolean hasError() {
        return requirements.stream().anyMatch(item -> item.check().status() == PermissionCheck.CheckStatus.ERROR);
    }

    public boolean needsApproval() {
        return requirements.stream().anyMatch(item -> item.check().status() == PermissionCheck.CheckStatus.NEED_ASK);
    }
}
