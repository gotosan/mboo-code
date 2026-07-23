package com.yu.mboocode.llm.tool;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.llm.tool.permission.PathKind;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

/**
 * 无副作用的写入权限演示工具：完整走路径解析、授权与持久化流程，不创建/修改文件。
 */
public class FileWritePermissionDemoTool {
    @Tool("演示文件写入权限申请。接收目标文件路径并完成授权流程，但不会创建目录、创建文件或修改任何文件内容。")
    @ToolPermission(
            value = ToolPermissionType.WRITE,
            pathParam = "path",
            pathKind = PathKind.FILE,
            title = "允许写入目录？"
    )
    public String demoWriteFile(@P(name = "path", value = "目标文件路径，授权范围为其父目录") String path) {
        String target = StrUtil.trim(path);
        return "已通过写入权限校验（演示工具，未实际写入文件）。目标路径：" + target;
    }
}
