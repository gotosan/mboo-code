package com.yu.mboocode.agent.controller;

import com.yu.mboocode.agent.dto.WorkspaceSelectResp;
import com.yu.mboocode.agent.service.ModelOptionService;
import com.yu.mboocode.agent.service.WorkspaceDirectoryPicker;
import com.yu.mboocode.common.dto.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "配置")
@RestController
@RequestMapping("/config")
public class ConfigController {
    @Resource
    private WorkspaceDirectoryPicker workspaceDirectoryPicker;
    @Resource
    private ModelOptionService modelOptionService;

    @Operation(summary = "选择工作区目录")
    @PostMapping("/selectDirectory")
    public R<WorkspaceSelectResp> selectDirectory() {
        return R.ok(new WorkspaceSelectResp(workspaceDirectoryPicker.selectDirectory()));
    }

    @Operation(summary = "模型选项列表")
    @GetMapping("/modelList")
    public R<List<String>> listModels() {
        if (!modelOptionService.isAvailable()) {
            return R.failed(modelOptionService.getLoadErrorMessage());
        }
        return R.ok(modelOptionService.getModelNames());
    }
}
