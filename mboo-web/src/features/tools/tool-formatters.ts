import type { ToolCallStatus } from "@/lib/session-types";

/**
 * 单条工具的文案表：名词 + 三个阶段结论。
 * 卡片标题随阶段演进，状态徽标退为次要信号，避免「名词 + 状态词」两处重复表达同一件事。
 */
type ToolCopy = {
  /** 名词标签：授权等待等中性阶段使用，也用于授权卡片 */
  label: string;
  /** 执行中 */
  running: string;
  /** 执行完成 */
  done: string;
  /** 执行失败 */
  failed: string;
};

const TOOL_COPY: Record<string, ToolCopy> = {
  spawn_agent: {
    label: "创建子 Agent",
    running: "正在创建子 Agent",
    done: "子 Agent 已创建",
    failed: "创建子 Agent 失败",
  },
  send_agent_message: {
    label: "继续子任务",
    running: "正在向子 Agent 追加指令",
    done: "已向子 Agent 追加指令",
    failed: "追加指令失败",
  },
  wait_agents: {
    label: "等待子任务",
    running: "正在等待子 Agent",
    done: "子 Agent 已返回结果",
    failed: "等待子 Agent 失败",
  },
  cancel_agent: {
    label: "取消子任务",
    running: "正在取消子 Agent",
    done: "子 Agent 已取消",
    failed: "取消子 Agent 失败",
  },
  glob_files: {
    label: "查找文件",
    running: "正在查找文件",
    done: "文件查找已完成",
    failed: "文件查找失败",
  },
  search_text: {
    label: "搜索文本",
    running: "正在搜索文本",
    done: "文本搜索已完成",
    failed: "文本搜索失败",
  },
  read_file: {
    label: "读取文件",
    running: "正在读取文件",
    done: "文件读取已完成",
    failed: "文件读取失败",
  },
  edit_file: {
    label: "编辑文件",
    running: "正在编辑文件",
    done: "文件编辑已完成",
    failed: "文件编辑失败",
  },
  write_file: {
    label: "写入文件",
    running: "正在写入文件",
    done: "文件写入已完成",
    failed: "文件写入失败",
  },
  run_command: {
    label: "执行命令",
    running: "正在执行命令",
    done: "命令执行已完成",
    failed: "命令执行失败",
  },
  web_search: {
    label: "网络搜索",
    running: "正在搜索网络",
    done: "网络搜索已完成",
    failed: "网络搜索失败",
  },
  web_fetch: {
    label: "网页抓取",
    running: "正在抓取网页",
    done: "网页抓取已完成",
    failed: "网页抓取失败",
  },
  activate_skill: {
    label: "激活 Skill",
    running: "正在激活 Skill",
    done: "Skill 已激活",
    failed: "Skill 激活失败",
  },
  read_skill_resource: {
    label: "读取 Skill 资源",
    running: "正在读取 Skill 资源",
    done: "Skill 资源读取已完成",
    failed: "Skill 资源读取失败",
  },
};

export function getToolLabel(toolName: string) {
  return TOOL_COPY[toolName]?.label ?? toolName;
}

/**
 * 折叠标题与行内标题使用：同一张卡在运行、完成、失败时主文案本身在变。
 * 授权等待阶段保持名词，由独立徽标表达「等待授权」，避免标题与徽标语义冲突。
 */
export function getToolPhaseLabel(toolName: string, status: ToolCallStatus) {
  const copy = TOOL_COPY[toolName];
  if (status === "completed") return copy?.done ?? `${toolName} 已完成`;
  if (status === "failed") return copy?.failed ?? `${toolName} 调用失败`;
  if (status === "started") return copy?.running ?? `正在调用 ${toolName}`;
  return copy?.label ?? toolName;
}

export function isActiveToolStatus(status: ToolCallStatus) {
  return status === "started" || status === "waiting_approval" || status === "submitting";
}

export function toolStatusLabel(status: ToolCallStatus) {
  if (status === "waiting_approval") return "等待授权";
  if (status === "submitting") return "处理中";
  if (status === "started") return "运行中";
  if (status === "completed") return "完成";
  return "失败";
}

export function toolStatusClassName(status: ToolCallStatus) {
  if (isActiveToolStatus(status)) {
    return "bg-running-soft text-running";
  }
  if (status === "completed") return "bg-ok-soft text-ok";
  return "bg-danger-soft text-danger";
}

function hasDiffContent(text: string) {
  return text.split("\n").some((line) => line.startsWith("@@") || line.startsWith("--- "));
}

export function diffLineClassName(line: string) {
  if (line.includes("已截断，省略")) return "bg-panel-elevated text-text-3";
  if (line.startsWith("--- ") || line.startsWith("+++ ")) return "bg-running-soft text-running";
  if (line.startsWith("@@")) return "bg-running-soft/60 text-running";
  if (line.startsWith("+")) return "bg-ok/10 text-ok";
  if (line.startsWith("-")) return "bg-danger-soft text-danger";
  return "text-text-2";
}

export function shouldShowDiff(toolName: string, text: string) {
  return (toolName === "edit_file" || toolName === "write_file") && hasDiffContent(text);
}
