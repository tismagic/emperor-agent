# Claude Code Gap Capability Backlog

Date: 2026-07-02

Source report: `/Users/anhuike/Desktop/emperor-agent-vs-claude-code-架构差距报告-2026-07-01.md`

This backlog converts the report into Emperor Agent feature slices. It is not a mandate to copy Claude Code. Items are classified as implemented by the 2026-07-02 isolation/runtime plan, planned, deferred, or not applicable.

## Status Legend

- `implemented`: covered by the current isolation/runtime hardening work.
- `planned`: valid Emperor Agent feature slice, not implemented yet.
- `deferred`: valid idea, lower priority or needs prior telemetry/profiling.
- `not_applicable`: Claude Code mechanism does not fit local single-user Electron positioning.

## Implemented By Current Plan

| Report item                                                      | Status              | Project receipt                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 true cancellation for model/tools/shell                     | implemented         | `EA-REL-001`: turn `AbortSignal`, cancellable `run_command`, active task abort path                                                                           |
| P0-2 dispatch cancellation must not be overwritten by completion | implemented         | `EA-CAP-P0-001`: `DispatchSubagentTool` rechecks terminal task status before sidechain completion; covered by `packages/core/src/subagents/subagents.test.ts` |
| P0-3 compaction failure must not poison completed reply          | implemented         | `EA-REL-002`: compactor errors become degraded runtime state; memory compaction keeps history on failure                                                      |
| P0-4 dynamic context window                                      | implemented         | `EA-REL-002`: routed runners use `route.snapshot.contextWindowTokens`; context usage emits active max/threshold                                               |
| Runtime replay losing chat/tool structure                        | implemented/partial | `EA-RUNTIME-001/002`: session-scoped replay API, archive-aware replay, pure chat projection reducer                                                           |
| Workspace/path confusion                                         | implemented         | `EA-ISO-*`, `EA-MEM-*`, `EA-PERM-001`: `.emperor` state root, project state store, workspace fence diagnostics                                                |
| Internal error on cancel/ask flow                                | implemented         | `EA-RUNTIME-004`, `EA-REL-001`: cancellation and control interactions use domain errors/events                                                                |
| Tool card render failure on unknown/error events                 | implemented         | `EA-RUNTIME-003`: resilient tool card projection and unknown event degradation                                                                                |
| Compactor prompt should cap long user/assistant text             | implemented         | `EA-CAP-P1-013`: `messagesToText` caps text blocks before compaction prompt; covered by `packages/core/src/memory/compactor-token.test.ts`                    |
| Provider retry and per-call fallback degradation                 | implemented         | `EA-CAP-P1-001`: retryable provider errors get bounded retry; auth does not retry; configured fallback degrades only the current call                         |
| Context overflow should recover once inside the turn             | implemented         | `EA-CAP-P1-005`: provider context overflow classifier, emergency context shrink retry, and `context_overflow` domain error                                    |
| Aggregate tool result budget                                     | implemented         | `EA-CAP-P1-011`: context pipeline replaces largest tool results when a batch exceeds the aggregate budget; `context_usage` reports replacement counts         |
| Shell risk parser                                                | implemented         | `EA-CAP-P1-006`: shell command tokenizer classifies command segments and keeps complex shell out of low-risk allowlist                                        |
| ACCEPT_EDITS permission mode                                     | implemented         | `EA-CAP-P1-007`: middle permission mode accepts ordinary file edits while shell/team/scheduler mutations still ask                                            |
| User configurable permission rules                               | implemented         | `EA-CAP-P1-002`: `emperor.local.json` permission rules support deny/ask/allow matching with diagnostics and runtime injection                                 |
| Web search tool                                                  | implemented         | `EA-CAP-P1-008`: provider-agnostic `web_search` tool returns structured untrusted results through an adapter, or a clear backend-missing error                |

## P1 Planned Feature Slices

### EA-CAP-P1-001 · Provider Retry And Cross-Provider Degradation

Source: report A-1.

Status: implemented on 2026-07-02.

Scope: wrap model calls in a thin retry/degradation layer above `ModelRouter`/`LLMProvider`.

Design slice:

- Classify provider errors: rate limit, transient network, auth/config, context overflow, permanent provider error.
- Retry transient/rate-limit errors with bounded backoff.
- Allow optional fallback to another provider role for scheduler/team unattended turns.
- Emit diagnostics on retry count, final provider, and degradation reason.

Acceptance:

- Fake provider fails with retryable error twice then succeeds. Covered by `packages/core/src/agent/runner.test.ts`.
- Non-retryable auth error does not retry.
- Scheduler/team route can degrade to configured fallback without mutating main route config.

### EA-CAP-P1-002 · User Configurable Permission Rules

Source: report A-2, C permission 1.

Status: implemented on 2026-07-02.

Scope: add user-configurable allow/deny/ask rules on top of `PermissionPipeline` and `WorkspacePolicy`.

Design slice:

- Config file section: `permissions.rules[]`.
- Match dimensions: tool name, command prefix/argv, path glob, access type.
- Deny rules are fail-closed and cannot be overridden by hooks or plan tokens.
- AskCard displays matched rule id and risk reason.

Acceptance:

- Deny `write_file` to a configured glob even in AUTO. Covered by `packages/core/src/agent/loop.test.ts`.
- Allow low-risk write path only in `ASK_BEFORE_EDIT`/`ACCEPT_EDITS`, not PLAN.
- Diagnostics lists loaded rule count and invalid rules.

### EA-CAP-P1-003 · Session Fork

Source: report A-3.

Scope: implement `sessions.fork(sessionId, atTurnId?)` without file rewind.

Design slice:

- Copy session metadata, history, checkpoint, prompt snapshots, and runtime events up to fork point.
- New session receives a `forked_from` receipt.
- Build sessions keep the same `project_id` and workspace path; private state remains isolated by new session id.

Acceptance:

- Fork current chat session and continue independently.
- Fork build session keeps project memory source but writes new history under new session dir.
- Runtime replay for fork does not include post-fork source events.

### EA-CAP-P1-004 · Streaming Tool Call Early Enqueue

Source: report B-2.1.

Scope: start long-running tools once a streamed tool call is complete, before full assistant text finishes.

Design slice:

- Extend provider stream API with optional `onToolCallComplete(call)`.
- Add queued/running state in `ToolExecutionEngine` that can accept calls incrementally.
- Keep final tool messages ordered by original tool call order.
- v1 supports `run_command` and `dispatch_subagent`; other tools remain batch.

Acceptance:

- Fake streaming provider emits text then tool call; shell starts before final text chunk.
- Ordered tool results are stable.
- Abort cancels queued and running streamed tools.

### EA-CAP-P1-005 · Reactive Context Overflow Recovery

Source: report B-2.5, D-4.

Status: implemented on 2026-07-02.

Scope: recover once from provider context-length errors inside the same turn.

Design slice:

- Add provider error classifier for context overflow.
- On overflow, force context projection shrink and/or compaction once, then retry the same route.
- If retry still overflows, return a domain error with suggested user action.

Acceptance:

- Fake provider throws context overflow once; runner emergency-shrinks projection and retries. Covered by `packages/core/src/agent/runner.test.ts`.
- Second overflow returns a clear `context_overflow` error, not `Internal error`.
- Retry does not duplicate user messages or tool calls.

### EA-CAP-P1-006 · Shell Risk Parser

Source: report C permission 2.

Status: implemented on 2026-07-02.

Scope: replace substring-only shell risk checks with argv/token-level parsing for supported shells.

Design slice:

- Parse simple shell argv and detect separators/redirections explicitly.
- Classify per command segment.
- Preserve existing high-risk deny coverage.
- Unknown complex shell remains approval-required.

Acceptance:

- Existing permission tests still pass. Covered by `packages/core/src/permissions/permissions.test.ts`.
- Encoded/newline/chained dangerous commands are not downgraded.
- Safe allowlist still covers `git status`, `git diff`, `npm test`, `pytest`.

### EA-CAP-P1-007 · ACCEPT_EDITS Permission Mode

Source: report C permission 3.

Status: implemented on 2026-07-02.

Scope: add middle mode: file edits can auto-run inside workspace; shell/team/scheduler still ask.

Design slice:

- Extend `PermissionMode`.
- UI mode selector and persisted config support.
- `WorkspacePolicy` still denies state/outside paths regardless of mode.

Acceptance:

- `write_file`/`edit_file` inside workspace allowed. Covered by `packages/core/src/permissions/permissions.test.ts`.
- `run_command`, scheduler mutation, team wake still require approval.
- Plan mode behavior unchanged.

### EA-CAP-P1-008 · Web Search Tool

Source: report C tool list.

Status: implemented on 2026-07-02.

Scope: add first-class `web_search` tool distinct from `web_fetch`.

Design slice:

- Provider-agnostic search adapter with local config for backend.
- Result schema includes title, url, snippet, source, timestamp.
- Tool result marks web content as untrusted.
- Permission policy treats network search as read-only but externally sourced.

Acceptance:

- Search returns structured results or clear backend-missing error. Covered by `packages/core/src/tools-and-context.test.ts`.
- No raw HTML enters model context by default.
- Tests use fake search adapter.
- `web_search` is registered in `AgentLoop` and treated as read-only in Plan mode.

### EA-CAP-P1-009 · Desktop Notification Tool

Source: report C tool list.

Scope: expose a controlled desktop notification path through Electron main.

Design slice:

- Core tool emits notification request event.
- Electron main owns OS `Notification` call.
- Permission policy requires approval for notification spam or scheduled notifications.

Acceptance:

- Renderer/main test verifies notification event mapping.
- Tool result returns notification id/status.
- Disabled desktop notifications degrade cleanly.

### EA-CAP-P1-010 · Background Shell Task Framework

Source: report C tool list, E gap 1.

Scope: add `run_command({ background: true })` using `spawn`, `TaskKind.SHELL`, output files, and query/kill APIs.

Design slice:

- Foreground shell keeps current behavior.
- Background shell writes incremental stdout/stderr to `.emperor/tasks/<id>/output.log`.
- Active process handle supports cancel/kill.
- UI can list, inspect, and cancel shell tasks.

Acceptance:

- Long command returns task id immediately.
- Output can be tailed through CoreApi.
- Cancel kills child process and records task cancelled event.

### EA-CAP-P1-011 · Aggregate Tool Result Budget

Source: report D-1.

Status: implemented on 2026-07-02.

Scope: cap total tool result characters per assistant turn, not only per tool message.

Design slice:

- Group tool results by turn/tool batch.
- If aggregate exceeds budget, replace largest results first using existing artifact/result store.
- Context usage event reports replacements.

Acceptance:

- Ten medium tool results trigger aggregate replacement. Covered by `packages/core/src/agent/runner.test.ts` and `packages/core/src/tools-and-context.test.ts`.
- Individual small result remains visible until aggregate cap is exceeded.
- Replacement is deterministic across replay.

### EA-CAP-P1-012 · Memory Extraction Decoupled From Compaction

Source: report D-5.

Scope: split long-term memory extraction from conversation compaction.

Design slice:

- New `MemoryExtractor` service with trigger policy: tool-count, elapsed time, or idle conversation boundary.
- Compactor remains responsible for context length.
- Store extraction diagnostics separately from compaction diagnostics.

Acceptance:

- Tool-heavy short-token session extracts memory without compaction.
- Light chat can extract after idle/turn threshold.
- Extraction failure does not compact or clear history.

### EA-CAP-P1-014 · Team Wake TaskManager Integration

Source: report E gap 2.

Scope: route teammate wake through active/task registries.

Design slice:

- `wakeTeammate` registers active task with `kind: 'team'`.
- `TaskKind.TEAM_WAKE` records progress and final summary.
- `stopRuntime({ kind: 'team' })` cancels the active wake path or is removed if unsupported.

Acceptance:

- Active tasks API shows running teammate.
- Stop team cancels or returns explicit unsupported error.
- Team checkpoint recovery still works.

### EA-CAP-P1-015 · Task Lifecycle Runtime Events

Source: report E gap 4.

Scope: wire existing task lifecycle event constructors into `TaskManager`.

Design slice:

- Add optional event sink to `TaskManager`.
- Emit started/progress/output/done/error/cancelled for all task kinds.
- Existing runtime replay projects task panels without polling-only behavior.

Acceptance:

- Starting/completing/failing/cancelling task appends runtime events.
- Scheduler/subagent/plan execution task flows keep existing store semantics.
- Renderer task projection receives events on replay.

### EA-CAP-P1-016 · Model-Requested Plan Mode

Source: report F gap 1.

Scope: add `request_plan_mode` tool that asks the user to switch into Plan mode safely.

Design slice:

- Visible outside Plan mode.
- Internally creates `ask_user` interaction with reason and suggested scope.
- Does not expose `propose_plan` mutation outside Plan mode.

Acceptance:

- Required-plan guard can drive model into `request_plan_mode`.
- User answer resumes normal turn.
- Refusal produces clear blocked state, not naked text.

### EA-CAP-P1-017 · Archived Turn Replay On Demand

Source: report G-2.1.

Scope: expose a turn-scoped archived event replay API and UI expansion path.

Design slice:

- CoreApi endpoint: replay events for session + turn id, including archive files.
- Renderer expands old compacted message into thought/tool segments on demand.
- Keep default bootstrap replay bounded.

Acceptance:

- Archived gzip event for a turn can be fetched and projected.
- UI does not load all archives at startup.
- Missing archive returns empty structured result.

## P2 Deferred Or Lower-Priority Slices

| Task                                                     | Source         | Status                              | Defer reason                                                         |
| -------------------------------------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------------------- |
| EA-CAP-P2-001 startup parallel prefetch                  | A-7            | deferred                            | Needs profiling; current startup bottleneck unknown                  |
| EA-CAP-P2-002 user+project config layering               | A-8            | deferred                            | Useful after permission/project policy config exists                 |
| EA-CAP-P2-003 tool concurrency limit and sibling cancel  | B-2.2          | planned after streaming/cancel      | Needs `ToolExecutionEngine` queue semantics first                    |
| EA-CAP-P2-004 PreToolUse/PostToolUse hooks               | C protocol 1   | planned after permission rules      | Hooks must not bypass deny policy                                    |
| EA-CAP-P2-005 tool progress protocol                     | C protocol 2   | planned after background shell      | Needs common task/progress event path                                |
| EA-CAP-P2-006 ToolSearch/delayed tool loading            | C protocol 3   | deferred                            | Current built-in tool count is still small                           |
| EA-CAP-P2-007 large result replacement unification       | C protocol 4   | planned after aggregate budget      | Reuse result store once budget policy is done                        |
| EA-CAP-P2-008 OS sandbox for run_command                 | C permission 4 | deferred                            | Needs product decision per macOS/Linux support                       |
| EA-CAP-P2-009 subagent timeout/targeted cancel           | E gap 3        | planned after active subagent tasks | Depends on task/active registry integration                          |
| EA-CAP-P2-010 sidechain intermediate transcript          | E gap 6        | deferred                            | Useful, not blocking single-user workflow                            |
| EA-CAP-P2-011 Plan attachment throttle                   | F gap 2        | deferred                            | Plan context size currently bounded; revisit with real traces        |
| EA-CAP-P2-012 verification risk fallback                 | F gap 4        | planned                             | Add after QA receipt cases identify misses                           |
| EA-CAP-P2-013 todo dependency graph                      | F gap 5        | deferred                            | Current Plan model is single-active-step by design                   |
| EA-CAP-P2-014 plan scratch path exception                | F gap 6        | deferred                            | Structured `propose_plan` remains preferred                          |
| EA-CAP-P2-015 runtime side-effect watcher hub            | G-2.2          | deferred                            | Refactor only as side effects grow                                   |
| EA-CAP-P2-016 additional pure runtime reducers/selectors | G-2.3/2.4      | planned gradually                   | Continue when touching each event family                             |
| EA-CAP-P2-017 IPC reconnect with seq catch-up            | G-2.5          | deferred                            | Needed for multi-window/remote, not current desktop                  |
| EA-CAP-P2-018 assertMutation docs                        | A-6            | planned doc-only                    | Clarify boundary between UI mutation guard and agent tool permission |

## Not Applicable

| Report area                                        | Reason                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Ink/React terminal rendering                       | Emperor Agent is Electron/Vue desktop software                         |
| Anthropic beta/header protocol details             | Emperor Agent is multi-provider                                        |
| GrowthBook flags, telemetry, enterprise MDM policy | Not part of local personal agent positioning                           |
| Claude Code teammate/swarm internals               | Internally gated and lower-quality fit than Emperor Team model         |
| Worktree/GitHub webhook/terminal panel tools       | Coding CLI/enterprise workflows; revisit only if product scope changes |

## Dependency Order

1. Finish remaining correctness and receipt work: `EA-CAP-P0-001`, then `EA-QA-001`.
2. Add user-visible capability: `EA-CAP-P1-009`, `EA-CAP-P1-010`.
3. Unify tasks/team/background flows: `EA-CAP-P1-014`, `EA-CAP-P1-015`, then subagent targeted cancel.
4. Improve session/planning/runtime UX: `EA-CAP-P1-003`, `EA-CAP-P1-016`, `EA-CAP-P1-017`.

## Verification Template For Each Slice

- Unit tests for the domain service or reducer.
- CoreApi or IPC contract test when an operation crosses process boundary.
- Renderer projection/model test when UI state changes.
- `npm test --workspace @emperor/core`
- `npm --prefix desktop run test`
- `npm run typecheck --workspace @emperor/core`
- `npm --prefix desktop run typecheck`
- `git diff --check`

## Rollback Policy

Each slice must keep storage migrations additive and reversible. If a slice writes new `.emperor` state, it must tolerate missing/corrupt new files and avoid deleting old state. Feature slices that add tools or CoreApi operations should be removable by unregistering the tool/operation without changing existing session history.
