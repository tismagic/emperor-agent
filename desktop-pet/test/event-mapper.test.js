const test = require("node:test");
const assert = require("node:assert/strict");
const { bubbleForContent, bubbleForTool, clipBubbleText, mapRuntimeEvent, toolAnimation } = require("../event-mapper");

test("maps runtime lifecycle events", () => {
  assert.deepEqual(mapRuntimeEvent({ event: "user_message" }), {
    animation: "thinking",
    bubble: "收到，开始想。",
  });
  assert.deepEqual(mapRuntimeEvent({ event: "ask_request" }), {
    animation: "notification",
    bubble: "需要主人拍板。",
    bubbleDurationMs: 0,
  });
  assert.equal(mapRuntimeEvent({ event: "plan_draft" }).bubble, "需要主人拍板。");
  assert.equal(mapRuntimeEvent({ event: "plan_draft" }).bubbleDurationMs, 0);
  assert.equal(mapRuntimeEvent({ event: "turn_paused" }).animation, "notification");
  assert.equal(mapRuntimeEvent({ event: "turn_paused" }).bubbleDurationMs, 0);
  assert.equal(mapRuntimeEvent({ event: "assistant_done" }).animation, "happy");
  assert.equal(mapRuntimeEvent({ event: "assistant_done" }).bubble, "办好了。");
  assert.equal(
    mapRuntimeEvent({ event: "assistant_done", content: "奉天承运皇帝诏曰，事情已经办妥。" }).bubble,
    "办好了：奉天承运皇帝诏曰，事情已经办妥。",
  );
  assert.equal(mapRuntimeEvent({ event: "assistant_done" }).resetAfterMs, 4000);
  assert.equal(mapRuntimeEvent({ event: "runtime_task_cancelled" }).animation, "dizzy");
  assert.equal(mapRuntimeEvent({ event: "runtime_task_cancelled" }).bubble, "已停下当前任务。");
  assert.equal(mapRuntimeEvent({ event: "unknown" }), null);
});

test("maps tools to tool-aware animations", () => {
  assert.equal(toolAnimation("read_file"), "debugger");
  assert.equal(toolAnimation("grep"), "debugger");
  assert.equal(toolAnimation("write_file"), "typing");
  assert.equal(toolAnimation("run_command"), "building");
  assert.equal(toolAnimation("web_fetch"), "wizard");
  assert.equal(toolAnimation("mcp_server_call"), "beacon");
  assert.equal(toolAnimation("dispatch_subagent"), "conducting");
});

test("maps tools to detailed clipped bubbles without raw object payload", () => {
  const effect = mapRuntimeEvent({
    event: "tool_call",
    name: "read_file",
    arguments: { path: "/private/secret-plan.md" },
  });

  assert.equal(bubbleForTool("read_file", { path: "/private/secret-plan.md" }), "正在读文件：secret-plan.md");
  assert.equal(bubbleForTool("run_command", { command: "date '+%Y年%m月%d日 %H:%M:%S'" }), "正在运行命令：date '+%Y年%m月%d日 %H:%M:%S'");
  assert.equal(effect.animation, "debugger");
  assert.equal(effect.bubble, "正在读文件：secret-plan.md");
  assert.equal(effect.bubble.includes("/private"), false);
  assert.equal(effect.bubble.includes("[object Object]"), false);
});

test("clips detailed content bubbles", () => {
  assert.equal(clipBubbleText("一二三四五六七八九十", 8), "一二三四五...");
  assert.equal(bubbleForContent("正在回复：", "  奉天\n承运  "), "正在回复：奉天 承运");
  const effect = mapRuntimeEvent({ event: "message_delta", delta: "这是一段会进入桌宠气泡的详细回复内容".repeat(6) });
  assert.equal(effect.animation, "typing");
  assert.equal(effect.bubble.startsWith("正在回复：这是一段会进入桌宠气泡的详细回复内容"), true);
  assert.equal(effect.bubble.endsWith("..."), true);
  assert.equal(effect.appendAssistantDelta, true);
});

test("tracks subagent event effects", () => {
  assert.deepEqual(mapRuntimeEvent({ event: "subagent_start", agent_type: "reviewer", purpose: "检查变更" }), {
    animation: "conducting",
    bubble: "正在派遣队友：reviewer：检查变更",
    subagentDelta: 1,
  });
  assert.equal(mapRuntimeEvent({ event: "subagent_error" }).animation, "dizzy");
  assert.equal(mapRuntimeEvent({ event: "subagent_error" }).bubble, "队友那边出错了。");
  assert.equal(mapRuntimeEvent({ event: "team_run_tool_call" }).animation, "conducting");
  assert.equal(
    mapRuntimeEvent({ event: "team_run_tool_call", name: "grep", arguments: { pattern: "desktopPet" } }).bubble,
    "队友用工具：正在搜索：desktopPet",
  );
  assert.equal(mapRuntimeEvent({ event: "team_run_tool_call" }).subagentDelta, undefined);
});
