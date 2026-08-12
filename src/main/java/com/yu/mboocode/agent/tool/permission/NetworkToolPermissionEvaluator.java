package com.yu.mboocode.agent.tool.permission;

import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.agent.tool.network.NetworkAccessPolicy;
import com.yu.mboocode.agent.tool.network.NetworkOrigin;
import com.yu.mboocode.agent.tool.network.NetworkRequestValidator;
import com.yu.mboocode.agent.tool.network.NetworkToolException;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Component
public class NetworkToolPermissionEvaluator implements ToolPermissionEvaluator {
    @Resource
    private SessionService sessionService;
    @Resource
    private NetworkRequestValidator requestValidator;
    @Resource
    private NetworkAccessPolicy accessPolicy;

    @Override
    public boolean supports(ToolPermissionSpec spec) {
        return spec.permissionType() == ToolPermissionType.NETWORK;
    }

    @Override
    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        JSONObject arguments = requestValidator.parseArguments(request.arguments());
        NetworkRequestValidator.WebFetchArguments fetch = requestValidator.validateFetch(arguments);
        SessionPermissions permissions = sessionService.getSessionPermissions(sessionId);
        PermissionCheck toolCheck = permissions.getAllowedTools().contains(request.name()) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
        List<PermissionRequirement> requirements = new ArrayList<>();
        requirements.add(new PermissionRequirement(ToolPermissionType.TOOL, null, request.name(), "允许网页抓取", "允许 Agent 抓取匿名 HTTP/HTTPS 文本资源。", toolCheck));
        try {
            long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            NetworkAccessPolicy.Inspection inspection = accessPolicy.inspect(fetch.url(), deadline);
            if (inspection.targetClass() == NetworkAccessPolicy.TargetClass.PRIVATE) {
                String origin = inspection.origin().toString();
                PermissionCheck networkCheck = permissions.getAllowedNetworkOrigins().contains(origin) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
                requirements.add(new PermissionRequirement(ToolPermissionType.NETWORK, null, origin, "允许访问私有网络来源",
                        "只授权该协议、主机和端口，不包含其他网络来源。", networkCheck));
            }
        } catch (NetworkToolException e) {
            String origin = NetworkOrigin.from(fetch.url()).toString();
            PermissionCheck check = PermissionCheck.error(e.getErrorCode(), e.getUserMessage());
            return new ToolPermissionChain(List.of(new PermissionRequirement(ToolPermissionType.NETWORK, null, origin,
                    "网页抓取目标不可访问", "当前网络目标未通过安全检查。", check)));
        }
        return new ToolPermissionChain(requirements);
    }
}
