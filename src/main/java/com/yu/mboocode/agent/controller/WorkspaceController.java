package com.yu.mboocode.agent.controller;

import com.yu.mboocode.common.dto.R;
import com.yu.mboocode.agent.dto.WorkspaceSelectResp;
import com.yu.mboocode.agent.service.WorkspaceDirectoryPicker;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "工作区")
@RestController
@RequestMapping("/workspace")
public class WorkspaceController {
    @Resource
    private WorkspaceDirectoryPicker workspaceDirectoryPicker;

    @Operation(summary = "选择工作区目录")
    @PostMapping("/select-directory")
    public R<WorkspaceSelectResp> selectDirectory() {
        return R.ok(new WorkspaceSelectResp(workspaceDirectoryPicker.selectDirectory()));
    }
}
