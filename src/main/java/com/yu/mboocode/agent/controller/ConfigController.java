package com.yu.mboocode.agent.controller;

import com.yu.mboocode.agent.dto.ModelContextLimitReq;
import com.yu.mboocode.agent.dto.ModelContextLimitResp;
import com.yu.mboocode.agent.dto.ModelSettingsResp;
import com.yu.mboocode.agent.dto.ModelSettingsUpdateReq;
import com.yu.mboocode.agent.dto.WorkspaceSelectResp;
import com.yu.mboocode.agent.model.ModelInfo;
import com.yu.mboocode.agent.service.ModelContextPreferenceService;
import com.yu.mboocode.agent.service.ModelOptionService;
import com.yu.mboocode.agent.service.ModelSettingsService;
import com.yu.mboocode.agent.service.WorkspaceDirectoryPicker;
import com.yu.mboocode.common.dto.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    @Resource
    private ModelContextPreferenceService modelContextPreferenceService;
    @Resource
    private ModelSettingsService modelSettingsService;

    @Operation(summary = "选择工作区目录")
    @PostMapping("/selectDirectory")
    public R<WorkspaceSelectResp> selectDirectory() {
        return R.ok(new WorkspaceSelectResp(workspaceDirectoryPicker.selectDirectory()));
    }

    @Operation(summary = "模型选项列表")
    @GetMapping("/modelList")
    public R<List<String>> listModels() {
        return R.ok(modelOptionService.getModelNames());
    }

    @Operation(summary = "读取应用设置")
    @GetMapping("/modelSettings")
    public R<ModelSettingsResp> modelSettings() {
        return R.ok(modelSettingsService.get());
    }

    @Operation(summary = "测试模型服务设置")
    @PostMapping("/modelSettings/test")
    public R<ModelSettingsResp> testModelSettings(@RequestBody ModelSettingsUpdateReq req) {
        return R.ok(modelSettingsService.test(req));
    }

    @Operation(summary = "保存应用设置")
    @PutMapping("/modelSettings")
    public R<ModelSettingsResp> saveModelSettings(@RequestBody ModelSettingsUpdateReq req) {
        return R.ok(modelSettingsService.update(req));
    }

    @Operation(summary = "模型能力详情")
    @GetMapping("/modelInfo")
    public R<ModelInfo> modelInfo(@RequestParam String modelId) {
        return R.ok(modelOptionService.requireModelInfo(modelId));
    }

    @Operation(summary = "模型上下文窗口上限")
    @GetMapping("/modelContextLimit")
    public R<ModelContextLimitResp> modelContextLimit(@RequestParam String modelId) {
        return R.ok(modelContextPreferenceService.getContextLimit(modelId));
    }

    @Operation(summary = "保存模型上下文窗口上限")
    @PutMapping("/modelContextLimit")
    public R<ModelContextLimitResp> saveModelContextLimit(@RequestParam String modelId, @Valid @RequestBody ModelContextLimitReq req) {
        return R.ok(modelContextPreferenceService.saveContextLimit(modelId, req.contextLimit()));
    }

    @Operation(summary = "恢复模型上下文窗口上限")
    @DeleteMapping("/modelContextLimit")
    public R<ModelContextLimitResp> resetModelContextLimit(@RequestParam String modelId) {
        return R.ok(modelContextPreferenceService.resetContextLimit(modelId));
    }
}
