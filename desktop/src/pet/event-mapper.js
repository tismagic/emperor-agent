(function expose(factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    window.EmperorPetMapper = factory();
  }
})(function buildMapper() {
  const ASSETS = {
    idle: "clawd-idle-living.svg",
    sleeping: "clawd-sleeping.svg",
    disconnected: "clawd-disconnected.svg",
    thinking: "clawd-working-thinking.svg",
    debugger: "clawd-working-debugger.svg",
    typing: "clawd-working-typing.svg",
    building: "clawd-working-building.svg",
    conducting: "clawd-working-conducting.svg",
    wizard: "clawd-working-wizard.svg",
    beacon: "clawd-working-beacon.svg",
    sweeping: "clawd-working-sweeping.svg",
    notification: "clawd-notification.svg",
    happy: "clawd-happy.svg",
    dizzy: "clawd-dizzy.svg",
  };

  const READ_TOOLS = new Set(["read_file", "grep", "glob"]);
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "update_todos", "load_skill"]);
  const BUILD_TOOLS = new Set(["run_command", "scheduler"]);
  const WEB_TOOLS = new Set(["web_fetch"]);
  const BUBBLE_TEXT_LIMIT = 78;
  const TOOL_BUBBLES = {
    debugger: "正在查阅资料。",
    typing: "正在整理改动。",
    building: "正在运行命令。",
    conducting: "正在派遣队友。",
    wizard: "正在看看网页。",
    beacon: "正在呼叫外部工具。",
  };

  function compactText(value) {
    if (value === null || value === undefined) return "";
    if (!["string", "number", "boolean"].includes(typeof value)) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function clipBubbleText(value, limit = BUBBLE_TEXT_LIMIT) {
    const text = compactText(value);
    if (!text) return "";
    const max = Math.max(4, Number(limit) || BUBBLE_TEXT_LIMIT);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3).trimEnd()}...`;
  }

  function firstText(source, keys) {
    if (!source || typeof source !== "object") return "";
    for (const key of keys) {
      const text = compactText(source[key]);
      if (text) return text;
    }
    return "";
  }

  function fileName(value) {
    const text = compactText(value);
    if (!text) return "";
    const clean = text.split(/[?#]/)[0].replace(/\\/g, "/");
    return clean.split("/").filter(Boolean).pop() || clean;
  }

  function urlDisplay(value) {
    const text = compactText(value);
    if (!text) return "";
    try {
      const parsed = new URL(text);
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      return text;
    }
  }

  function bubbleWithDetail(prefix, detail, fallback) {
    const spaceForDetail = Math.max(12, BUBBLE_TEXT_LIMIT - prefix.length);
    const clipped = clipBubbleText(detail, spaceForDetail);
    return clipped ? `${prefix}${clipped}` : fallback;
  }

  function interactionDetail(interaction, kind) {
    if (!interaction || typeof interaction !== "object") return "";
    if (kind === "plan") return firstText(interaction, ["title", "summary", "plan_markdown"]);
    const firstQuestion = Array.isArray(interaction.questions) ? interaction.questions[0] : null;
    return firstText(firstQuestion, ["question", "header"]) || firstText(interaction, ["context", "title", "summary"]);
  }

  function jobDetail(job) {
    if (!job || typeof job !== "object") return "";
    return firstText(job, ["name", "id", "purpose"]);
  }

  function toolDetail(name, args) {
    const tool = String(name || "").toLowerCase();
    const input = args && typeof args === "object" ? args : {};
    if (tool === "read_file") return fileName(firstText(input, ["path", "file", "relative_path"]));
    if (tool === "grep") {
      const pattern = firstText(input, ["pattern", "query", "regex"]);
      const path = fileName(firstText(input, ["path", "include", "glob"]));
      return [pattern, path].filter(Boolean).join(" @ ");
    }
    if (tool === "glob") return firstText(input, ["pattern", "path", "glob"]);
    if (tool === "write_file" || tool === "edit_file") return fileName(firstText(input, ["path", "file", "relative_path"]));
    if (tool === "update_todos") {
      const todos = Array.isArray(input.todos) ? input.todos.length : "";
      return todos ? `${todos} 项待办` : "";
    }
    if (tool === "load_skill") return firstText(input, ["name", "skill", "path"]);
    if (tool === "run_command") return firstText(input, ["command", "cmd"]);
    if (tool === "scheduler") return firstText(input, ["action", "name", "job_id"]);
    if (tool === "web_fetch") return urlDisplay(firstText(input, ["url", "href"]));
    if (tool === "dispatch_subagent") {
      const agent = firstText(input, ["agent_type", "subagent", "name"]);
      const purpose = firstText(input, ["purpose", "task"]);
      return [agent, purpose].filter(Boolean).join("：");
    }
    if (tool.startsWith("mcp_")) return String(name || "");
    return firstText(input, ["name", "action", "path", "query"]);
  }

  function toolAnimation(name) {
    const tool = String(name || "").toLowerCase();
    if (!tool) return "typing";
    if (tool.startsWith("mcp_")) return "beacon";
    if (tool === "dispatch_subagent" || tool.includes("team") || tool.includes("broadcast")) return "conducting";
    if (READ_TOOLS.has(tool)) return "debugger";
    if (WRITE_TOOLS.has(tool)) return "typing";
    if (BUILD_TOOLS.has(tool)) return "building";
    if (WEB_TOOLS.has(tool)) return "wizard";
    return "typing";
  }

  function bubbleForTool(name, args) {
    const tool = String(name || "").toLowerCase();
    const detail = toolDetail(name, args);
    if (tool === "read_file") return bubbleWithDetail("正在读文件：", detail, "正在查阅资料。");
    if (tool === "grep") return bubbleWithDetail("正在搜索：", detail, "正在查阅资料。");
    if (tool === "glob") return bubbleWithDetail("正在匹配文件：", detail, "正在查阅资料。");
    if (tool === "write_file" || tool === "edit_file") return bubbleWithDetail("正在编辑：", detail, "正在整理改动。");
    if (tool === "update_todos") return bubbleWithDetail("正在更新：", detail, "正在更新待办。");
    if (tool === "load_skill") return bubbleWithDetail("正在加载技能：", detail, "正在加载技能。");
    if (tool === "run_command") return bubbleWithDetail("正在运行命令：", detail, "正在运行命令。");
    if (tool === "scheduler") return bubbleWithDetail("正在处理定时任务：", detail, "正在处理定时任务。");
    if (tool === "web_fetch") return bubbleWithDetail("正在查看网页：", detail, "正在看看网页。");
    if (tool === "dispatch_subagent" || tool.includes("team") || tool.includes("broadcast")) {
      return bubbleWithDetail("正在派遣队友：", detail, "正在派遣队友。");
    }
    if (tool.startsWith("mcp_")) return bubbleWithDetail("正在调用外部工具：", detail, "正在呼叫外部工具。");
    return bubbleWithDetail("正在处理工具：", detail || name, TOOL_BUBBLES[toolAnimation(name)] || "正在处理工具。");
  }

  function bubbleForContent(prefix, content, fallback) {
    return bubbleWithDetail(prefix, content, fallback);
  }

  function mapRuntimeEvent(event) {
    if (!event || typeof event !== "object") return null;
    const type = String(event.event || "");

    if (type === "user_message") return { animation: "thinking", bubble: "收到，开始想。" };
    if (type === "message_delta") {
      return {
        animation: "typing",
        bubble: bubbleForContent("正在回复：", event.delta, "正在回复。"),
        bubbleDurationMs: 2200,
        appendAssistantDelta: true,
      };
    }
    if (type === "scheduler_run_start") {
      return {
        animation: "thinking",
        bubble: bubbleWithDetail("定时任务开始：", jobDetail(event.job), "定时任务开始了。"),
      };
    }
    if (type === "tool_call") return { animation: toolAnimation(event.name), bubble: bubbleForTool(event.name, event.arguments) };
    if (type === "tool_result") {
      return { bubble: bubbleForContent("工具完成：", event.summary, "工具完成。"), bubbleDurationMs: 2600 };
    }
    if (type === "subagent_tool_call") {
      return { animation: toolAnimation(event.name), bubble: bubbleForContent("子代理用工具：", bubbleForTool(event.name, event.arguments), "子代理正在用工具。") };
    }
    if (type === "subagent_tool_result") {
      return { bubble: bubbleForContent("子代理完成：", event.summary, "子代理工具完成。"), bubbleDurationMs: 2600 };
    }
    if (type === "subagent_start" || type === "team_run_start") {
      const who = firstText(event, ["agent_type", "teammate", "role"]);
      const detail = [who, firstText(event, ["purpose"])].filter(Boolean).join("：");
      return { animation: "conducting", bubble: bubbleWithDetail("正在派遣队友：", detail, "正在派遣队友。"), subagentDelta: 1 };
    }
    if (type === "subagent_delta") {
      return { animation: "conducting", bubble: bubbleForContent("子代理回报：", event.delta, "子代理正在回报。"), bubbleDurationMs: 2200 };
    }
    if (type === "team_run_delta") {
      return { animation: "conducting", bubble: bubbleForContent("队友回报：", event.delta, "队友正在回报。"), bubbleDurationMs: 2200 };
    }
    if (type === "team_run_tool_call") {
      return { animation: "conducting", bubble: bubbleForContent("队友用工具：", bubbleForTool(event.name, event.arguments), "队友正在动手。") };
    }
    if (type === "team_run_tool_result") {
      return { bubble: bubbleForContent("队友完成：", event.summary, "队友工具完成。"), bubbleDurationMs: 2600 };
    }
    if (type === "subagent_done" || type === "team_run_done") {
      return { animation: "typing", bubble: bubbleForContent("队友回报了：", event.summary, "队友回报了。"), subagentDelta: -1 };
    }
    if (type === "subagent_error" || type === "team_run_error") {
      return {
        animation: "dizzy",
        bubble: bubbleForContent("队友出错：", event.message, "队友那边出错了。"),
        resetAfterMs: 2000,
        subagentDelta: -1,
      };
    }
    if (type === "ask_request") {
      return {
        animation: "notification",
        bubble: bubbleForContent("需要主人拍板：", interactionDetail(event.interaction, "ask"), "需要主人拍板。"),
        bubbleDurationMs: 0,
      };
    }
    if (type === "plan_draft") {
      return {
        animation: "notification",
        bubble: bubbleForContent("计划待批：", interactionDetail(event.interaction, "plan"), "需要主人拍板。"),
        bubbleDurationMs: 0,
      };
    }
    if (type === "turn_paused") {
      return {
        animation: "notification",
        bubble: bubbleForContent("暂停等待：", interactionDetail(event.interaction, event.interaction?.kind), "需要主人拍板。"),
        bubbleDurationMs: 0,
      };
    }
    if (
      type === "tool_error"
      || type === "scheduler_run_error"
      || type === "scheduler_run_cancelled"
      || type === "runtime_task_cancelled"
      || type === "error"
    ) {
      const bubble = type === "runtime_task_cancelled" ? "已停下当前任务。" : "这里有点不顺。";
      const detail = firstText(event, ["message", "error", "reason"]);
      return { animation: "dizzy", bubble: bubbleForContent(`${bubble.replace(/。$/, "")}：`, detail, bubble), resetAfterMs: 2000 };
    }
    if (type === "assistant_done" || type === "scheduler_run_done") {
      const detail = type === "assistant_done" ? event.content : jobDetail(event.job);
      return { animation: "happy", bubble: bubbleForContent("办好了：", detail, "办好了。"), resetAfterMs: 4000 };
    }
    return null;
  }

  return { ASSETS, bubbleForContent, bubbleForTool, clipBubbleText, mapRuntimeEvent, toolAnimation };
});
