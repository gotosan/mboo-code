package com.yu.mboocode.agent.controller;

import com.yu.mboocode.agent.dto.WorkspaceCreateReq;
import com.yu.mboocode.agent.dto.WorkspaceDeleteResp;
import com.yu.mboocode.agent.dto.WorkspaceResp;
import com.yu.mboocode.agent.service.WorkspaceService;
import com.yu.mboocode.common.dto.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "工作区")
@RestController
@RequestMapping("/workspace")
public class WorkspaceController {
    @Resource
    private WorkspaceService workspaceService;

    @Operation(summary = "保存工作区列表")
    @GetMapping("/list")
    public R<List<WorkspaceResp>> list() {
        return R.ok(workspaceService.listWorkspaces());
    }

    @Operation(summary = "新增或复用保存工作区")
    @PostMapping
    public R<WorkspaceResp> save(@Valid @RequestBody WorkspaceCreateReq req) {
        return R.ok(workspaceService.saveWorkspace(req.path()));
    }

    @Operation(summary = "删除工作区及全部下属会话")
    @DeleteMapping("/{workspaceId}")
    public R<WorkspaceDeleteResp> delete(@PathVariable String workspaceId) {
        return R.ok(workspaceService.deleteWorkspace(workspaceId));
    }
}
