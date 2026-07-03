# System Isolation And Runtime Receipt Matrix

Date: 2026-07-02

Plan: `docs/superpowers/plans/2026-07-02-emperor-agent-system-isolation-and-runtime-hardening.md`

This matrix records the concrete regression receipts for the user-reported failures:

- Empty Chat/empty workspace picking up old project context.
- Wrong project source path vs agent private state path.
- Stop/ask_user flows showing extra `Internal error`.
- Tool cards failing to render or disappearing after replay.
- Runtime/session memory crossing between sessions or projects.

## Incident Origin: Old Plan Leaked Into A New Empty Workspace

User-visible symptom:

- New workspace: `/Users/anhuike/Desktop/哈哈`
- User request: `汇报工作区内文件`
- Correct first answer: workspace is empty.
- Wrong follow-up: runner injected `继续执行计划 plan_e5a33b15f8fe，当前活动步骤：step_1 创建霓虹打砖块游戏。`

Trace:

- New session: `.emperor/sessions/47eef40870aa4abc`, title `构建 哈哈`, project path `/Users/anhuike/Desktop/哈哈`.
- Old source session: `.emperor/sessions/433b248adc044dd7`, title `构建 emperor`, project path `/Users/anhuike/Desktop/emperor`.
- Leaked plan: `.emperor/memory/plans/index.json` record `plan_e5a33b15f8fe`, status `executing`, active step `step_1`.
- Runtime event evidence in the new session included `context_projection.report.plan_context_attached: 1`, `plan_followup`, and `plan_verification_start`.
- Sidechain evidence: `.emperor/memory/tasks/planstep_c72cf502104e/transcript.jsonl` mixed tool outputs from `/Users/anhuike/Desktop/emperor`, `/Users/anhuike/Desktop/nbclass`, and `/Users/anhuike/Desktop/哈哈`.

Root cause:

- `PlanStore` was global.
- `ControlManager.latestExecutablePlan()` selected global approved/executing plans.
- `PlanContextBuilder.messageFor()` read `planStore.latest()` without session/project/workspace filtering.
- The user action "无视系统继续/放弃" did not mark the active plan cancelled or its unfinished steps skipped, so `[PLAN_INCOMPLETE]` could re-enter the model loop.

Fix strategy:

- New and approved plans now receive `metadata.scope` with `session_id`, `project_id`, and `workspace_root`.
- Runtime plan context and executable/reviewable plan selection now filter by the active session/project/workspace scope.
- Legacy unscoped executable plans are quarantined from scoped sessions instead of being auto-attached.
- Repeated plan followups in one turn degrade with `record_degraded(kind: "plan_followup_loop")` instead of running until `max_turns`.
- `TodoStore` now snapshots/restores todos per session, so unfinished todo followups cannot leak across session switches.
- `plan_step` tasks now include the plan scope in task metadata for later forensics.
- Core now rejects a second concurrent mainline turn before activating its target session, preventing a later request from mutating the in-flight turn's global control scope.
- Control answer/cancel runtime events are now written to the interaction owner's session store even if the user has switched to another session.
- Renderer live runtime events are ignored when their `session_id` belongs to another session; foreign control events only update the owning session's pending marker and bootstrap control state.
- Queued external messages and scheduler jobs now keep the session that received/created them; later drains/runs do not jump to whichever session is active at execution time.
- Team tool events emitted during a main turn now use the current tool context emitter, so they inherit the active turn/session scope instead of bypassing it through the global TeamManager sink.
- Persistent Team roster/inbox state now resolves by Build `project_id`; project A teammates are stored under `.emperor/projects/<projectId>/team/` and do not appear in project B or Chat fallback state.

## Automated Receipts

| Scenario | Receipt | Coverage |
|---|---|---|
| Runtime state must live under `.emperor`, not source workspace | `packages/core/src/api/core-api.test.ts` -> `stores new private runtime state under .emperor and reports effective paths` | Verifies `.emperor/memory`, `.emperor/sessions`, prompt snapshots, no legacy `memory/`/`sessions/` at runtime root |
| Runtime replay must be session-scoped | `packages/core/src/api/core-api.test.ts` -> `replays runtime events for the requested session only` | Prevents events from another session appearing in bootstrap/replay |
| Project source path and agent state path must be distinct | `packages/core/src/api/core-api.test.ts` -> `returns distinct workspace and agent state paths for resolved projects` | Verifies `workspace_path`, `state_path`, `memory_path`, no source `AGENTS.md` write |
| Empty Chat must not receive Build project private memory | `packages/core/src/api/core-api.test.ts` -> `keeps chat and build project contexts isolated in provider prompts` | Prevents `Project Index Summary` from leaking project memory into Chat prompts |
| Build project A/B must only receive its own project private memory | Same core-api isolation test | Verifies Build A prompt excludes Build B memory and vice versa |
| Old approved/executing plans must not leak across sessions/projects | `packages/core/src/control/control.test.ts` -> `does not expose executable plans across different session or project scopes`; `packages/core/src/agent/runner.test.ts` -> `does not project runtime plan context from another project scope` | Verifies `latestExecutablePlan()` and runtime plan context only use matching `session_id`/`project_id`/`workspace_root` |
| Repeated incomplete-plan followups must not loop to `max_turns` | `packages/core/src/agent/runner.test.ts` -> `stops repeated plan incomplete followups without reaching max turns or duplicating assistant history` | Verifies duplicate `[PLAN_INCOMPLETE]` in one turn emits `record_degraded(kind: "plan_followup_loop")` and stops the turn |
| User answer "ignore/abandon plan" must cancel the executable plan | `packages/core/src/control/control.test.ts` -> `cancels an executable plan when the user answers to ignore or abandon the stuck plan` | Verifies plan status becomes `cancelled`, unfinished steps become `skipped`, and no followup is generated |
| Unfinished todos must not leak across sessions | `packages/core/src/agent/loop.test.ts` -> `keeps unfinished todos scoped to the session that created them` | Verifies session activation saves/restores todo snapshots and new sessions start with their own todo state |
| Plan-step task records must be traceable to their owning scope | `packages/core/src/control/control.test.ts` -> `tags plan step tasks with the current runtime scope` | Verifies task metadata includes `scope.session_id`, `scope.project_id`, and `scope.workspace_root` |
| Concurrent mainline turns must not switch sessions underneath an in-flight turn | `packages/core/src/api/chat-service.test.ts` -> `rejects a second concurrent mainline turn before switching sessions` | Verifies the second turn fails with `TurnBusyError`, keeps `activeSessionId` on the first session, and writes no second-session history |
| Concurrent turn rejection must not render as `Internal error` | `desktop/src/main/ipc.test.ts` -> benign interruption mapping; `desktop/src/renderer/src/composables/useRuntime.test.ts` -> `turn_busy` UI test | Verifies IPC returns `code: "turn_busy"` and renderer avoids appending `出错了` |
| Control answer/cancel events must stay in the owning session | `packages/core/src/api/core-api.test.ts` -> `resumes answered control interactions in their owning session after the user switches away`; `records cancelled control interactions in their owning session after the user switches away` | Verifies `ask_answered` and `interaction_cancelled` are appended to the owner session runtime store with owner `session_id`, not the currently active session |
| Live renderer events from another session must not corrupt the active chat | `desktop/src/renderer/src/composables/useRuntime.test.ts` -> `ignores live runtime events from another session without advancing the active replay cursor`; `applies control pending changes to the event owner session instead of the currently open session` | Verifies foreign events are not rendered, do not advance `lastSeq`, and control pending changes are applied to the event owner session |
| Queued external messages must drain into the receiving session | `packages/core/src/api/core-api.test.ts` -> `drains queued external messages into the session that received them after the user switches away` | Verifies queued external turns and `external_queued` runtime events stay in the session that received the message, not the session active at drain time |
| Scheduler agent turns must run in the creating session | `packages/core/src/api/core-api.test.ts` -> `runs scheduler agent_turn jobs in the session that created them after the user switches away` | Verifies scheduled turns and `scheduler_run_start` runtime events stay in the job creator session, not the session active at execution time |
| Team tool events inside a turn must inherit the current turn scope | `packages/core/src/team/team.test.ts` -> `routes team tool runtime events through the current tool context emitter` | Verifies Team tools use the scoped tool context emitter when present, instead of writing runtime events through the global manager sink |
| Persistent Team roster/inbox must not leak across Build projects | `packages/core/src/api/core-api.test.ts` -> `keeps persistent Team roster isolated between build projects` | Verifies `api.team.get()` and mutations resolve the TeamManager from the active Build session's `project_id`, not a global singleton |
| File tools must explain wrong paths and block `.emperor` private state | `packages/core/src/tools.test.ts` + `packages/core/src/permissions/workspace-policy.test.ts` | Verifies requested path, allowed roots, denied roots, and symlink escape denial |
| Shell command risk must be token/segment based | `packages/core/src/tools-and-context.test.ts` -> command resolver tests; `packages/core/src/permissions/permissions.test.ts` | Verifies chained/newline/redirected/complex shell cannot enter low-risk allowlist, high-risk segments are caught, and quoted text is not misclassified as an executable dangerous command |
| Middle permission mode must accept edits without opening broader automation | `packages/core/src/permissions/permissions.test.ts` -> `accept_edits` tests; `packages/core/src/control/control.test.ts` -> plan restore test; `desktop/src/renderer/src/components/chat/composerControls.test.ts` | Verifies ordinary file edits can run, non-file mutations still ask, Plan mode remains read-only, plan approval restores `accept_edits`, and the Composer selector exposes the mode |
| User permission rules must override default allow/ask policy | `packages/core/src/permissions/permissions.test.ts` -> user rule tests; `packages/core/src/config/local-config.test.ts` -> local rule diagnostics; `packages/core/src/agent/loop.test.ts` -> real runtime injection test | Verifies deny/ask rules match tool, path glob, and command prefix; invalid rules are diagnosed; local config rules are loaded into the live permission pipeline |
| Diagnostics must show effective workspace fence | `packages/core/src/api/services/diagnostics-service.test.ts` + `desktop/src/renderer/src/components/panels/diagnosticsPanelModel.test.ts` | Verifies core payload and renderer row for workspace/state roots |
| Stop must not append visible `Internal error`/`出错了` | `desktop/src/renderer/src/composables/useRuntime.test.ts` -> cancellation tests | Verifies cancelled submit rejection and stop-after-submit path do not append error message |
| ask_user pause/resume must not append visible `Internal error` | `desktop/src/renderer/src/composables/useRuntime.test.ts` -> pause/control answer tests | Verifies paused turn and interaction answer path keep UI state consistent |
| Tool cards must tolerate unknown/malformed events | `desktop/src/renderer/src/composables/useRuntime.test.ts` -> tool card stability test | Verifies tool_run-only, result-first, malformed artifact/metadata, cancelled tools |
| Runtime replay must rebuild text/thought/tool/control segments | `desktop/src/renderer/src/runtime/chatProjection.test.ts` | Verifies pure replay projection for assistant text, thought, tool, ask |
| Ask/Plan/runtime projection should be pure where possible | `desktop/src/renderer/src/runtime/chatProjection.ts` and tests | Keeps replay and live events aligned |
| Subagent cancellation must not be overwritten by late completion | `packages/core/src/subagents/subagents.test.ts` -> `does not overwrite a subagent task that was cancelled before the runner returns` | Verifies externally cancelled subagent tasks stay `CANCELLED` and do not write final assistant sidechain |
| Memory compaction prompt must not include unbounded pasted text | `packages/core/src/memory/compactor-token.test.ts` -> `caps long user and assistant text before sending the compaction prompt` | Verifies long user/assistant messages are capped with a truncation marker before provider call |
| Retryable provider failures should recover without mutating routes | `packages/core/src/agent/runner.test.ts` -> provider retry/fallback tests; `packages/core/src/providers/providers.test.ts` -> `classifyProviderError` | Verifies bounded retry for transient failures, no retry for auth errors, fallback degradation for current call only, and retry/fallback diagnostics in `context_usage` |
| Provider context overflow must not become generic internal error | `packages/core/src/agent/runner.test.ts` -> context overflow recovery tests; `packages/core/src/providers/providers.test.ts` -> `classifyProviderError` | Verifies one emergency projection shrink retry, no duplicated assistant messages, and final `context_overflow` domain error after repeated overflow |
| Multiple medium tool results must not overflow context as a batch | `packages/core/src/tools-and-context.test.ts` -> `replaces the largest tool results when a batch exceeds the aggregate budget`; `packages/core/src/agent/runner.test.ts` -> `default context pipeline reports aggregate tool result replacements` | Verifies aggregate batch replacement, deterministic artifact references, visible small-result preservation, and `context_usage` replacement diagnostics |
| Web search must be structured, untrusted, and permission-safe | `packages/core/src/tools-and-context.test.ts` -> `web_search` tests; `packages/core/src/agent/loop.test.ts` -> builtin registry assertion | Verifies adapter-backed results include title/url/snippet/source/timestamp metadata, snippets are sanitized before model context, missing backends return a clear domain error, and Plan mode treats search as read-only |

## Manual Smoke Checklist

Run after UI-facing changes or before packaging:

1. Start desktop dev mode.
2. Create a Chat session and send `你好`.
3. Create Build project A and Build project B from two different directories.
4. Add/edit project memory for A and B.
5. Return to Chat and verify diagnostics/context do not expose A/B project memory.
6. In Build A, run a read-only file lookup; verify paths point to project A workspace and `.emperor/projects/<id>` for state.
7. Start a long command and stop it; verify no extra visible `Internal error`.
8. Trigger `ask_user`, answer it, and verify no extra visible `Internal error`.
9. Refresh/restart the app; verify previous tool cards and thought segments replay.
10. Open Settings -> Diagnostics; verify `Workspace Fence` shows workspace and state roots separately.

## Verification Commands

```bash
npm test --workspace @emperor/core
npm --prefix desktop run test
npm run typecheck --workspace @emperor/core
npm --prefix desktop run typecheck
git diff --check
```

For screenshot/UI verification when changing renderer surfaces:

```bash
npm --prefix desktop run screenshots
```

## Current Residual Risks

- This matrix is mostly unit/integration coverage. Full Electron Playwright screenshots should be run before a packaged release or after major layout changes.
- Archived event replay has core support, but the on-demand UI expansion path is tracked as `EA-CAP-P1-017`.
