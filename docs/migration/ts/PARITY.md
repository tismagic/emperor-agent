# Python Test Parity Map

Status: frozen evidence for `MIG-REL-004`. This file maps each retired Python source test file to the TypeScript/Vitest coverage surface that replaces it. It is not a substitute for the final green gates; REL-004 is only complete when this map is reviewed and the full TS gates pass.

Authoritative gates:

- `npm test --workspace @emperor/core`
- `npm run typecheck --workspace @emperor/core`
- `npm --prefix desktop run test`
- `npm --prefix desktop run typecheck`
- `npm --prefix desktop run build`
- `npm --prefix desktop run package:dir`

Frozen source inventory:

- Python source test files: 84
- TS/JS test files: checked by `scripts/check_migration_parity.mjs`
- Compatibility fixture: `packages/core/fixtures/python-runtime`
- Data compatibility test: `packages/core/src/compat/python-runtime-compat.test.ts`

| Python test | TS/Vitest parity surface |
|---|---|
| `tests/integration/test_project_execution_smoke.py` | `packages/core/src/plans/plans.test.ts`, `packages/core/src/tasks/tasks.test.ts`, `desktop/src/renderer/src/runtime/projectExecution.test.ts` |
| `tests/unit/test_active_tasks.py` | `packages/core/src/runtime/runtime.test.ts`, `packages/core/src/api/core-api.test.ts` |
| `tests/unit/test_agent_prompt_contracts.py` | `packages/core/src/agent/context-builder.test.ts`, `packages/core/src/tools.test.ts`, `packages/core/src/subagents/subagents.test.ts` |
| `tests/unit/test_anthropic_prompt_caching.py` | `packages/core/src/providers/providers.test.ts` |
| `tests/unit/test_auth_guard.py` | Retired by IPC topology; covered by `desktop/src/main/release-config.test.ts`, `desktop/src/main/protocol.test.ts`, `desktop/src/renderer/src/api/backend.test.ts` |
| `tests/unit/test_cli_onboarding.py` | `packages/core/src/config/model-config.test.ts`, `packages/core/src/api/services/model-service.test.ts`, `desktop/src/renderer/src/components/onboarding/onboardingModel.test.ts` |
| `tests/unit/test_compactor.py` | `packages/core/src/memory/compactor-token.test.ts`, `packages/core/src/api/services/memory-service.test.ts` |
| `tests/unit/test_context_pipeline.py` | `packages/core/src/tools-and-context.test.ts`, `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_context_scope.py` | `packages/core/src/agent/context-builder.test.ts`, `packages/core/src/agent/loop.test.ts` |
| `tests/unit/test_control.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/api/core-api.test.ts` |
| `tests/unit/test_conversation_store.py` | `packages/core/src/sessions/sessions.test.ts`, `packages/core/src/memory/memory.test.ts` |
| `tests/unit/test_desktop_pet.py` | `packages/core/src/api/services/desktop-pet-service.test.ts`, `desktop/src/pet/test/event-mapper.test.ts`, `desktop/src/pet/test/idle-scenes.test.ts` |
| `tests/unit/test_desktop_pet_api.py` | `packages/core/src/api/services/desktop-pet-service.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_external_bridge.py` | `packages/core/src/external/external.test.ts`, `packages/core/src/api/core-api.test.ts` |
| `tests/unit/test_filesystem.py` | `packages/core/src/tools.test.ts`, `packages/core/src/tools-and-context.test.ts` |
| `tests/unit/test_history_log.py` | `packages/core/src/memory/memory.test.ts`, `packages/core/src/store/jsonl.test.ts` |
| `tests/unit/test_loop_sessions.py` | `packages/core/src/agent/loop.test.ts`, `packages/core/src/sessions/sessions.test.ts` |
| `tests/unit/test_mainline_session_routing.py` | `packages/core/src/api/chat-service.test.ts`, `packages/core/src/api/core-api.test.ts` |
| `tests/unit/test_mainline_turn.py` | `packages/core/src/api/chat-service.test.ts`, `packages/core/src/agent/loop.test.ts` |
| `tests/unit/test_mcp_config.py` | `packages/core/src/mcp/mcp.test.ts`, `packages/core/src/api/services/config-service.test.ts` |
| `tests/unit/test_memory_service.py` | `packages/core/src/api/services/memory-service.test.ts` |
| `tests/unit/test_memory_versions.py` | `packages/core/src/memory/memory.test.ts`, `packages/core/src/api/services/memory-service.test.ts` |
| `tests/unit/test_model_router.py` | `packages/core/src/model/router.test.ts`, `packages/core/src/config/model-config.test.ts` |
| `tests/unit/test_origin_guard.py` | Retired by IPC topology; covered by `desktop/src/main/release-config.test.ts`, `desktop/src/main/protocol.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_permission_pipeline_v2.py` | `packages/core/src/permissions/permissions.test.ts`, `packages/core/src/api/mutation-guard.test.ts` |
| `tests/unit/test_permissions.py` | `packages/core/src/permissions/permissions.test.ts` |
| `tests/unit/test_plan_command_permissions.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/permissions/permissions.test.ts` |
| `tests/unit/test_plan_context_attachment.py` | `packages/core/src/tools-and-context.test.ts`, `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_plan_decision_policy.py` | `packages/core/src/control/control.test.ts` |
| `tests/unit/test_plan_discovery_ledger.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_draft_state.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_evidence_gate.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_execution_state.py` | `packages/core/src/plans/plans.test.ts`, `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_plan_guard_execution.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_plan_independent_verification.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_permission_tokens.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/permissions/permissions.test.ts` |
| `tests/unit/test_plan_quality_gate.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_readonly_exploration.py` | `packages/core/src/control/control.test.ts`, `packages/core/src/tools.test.ts` |
| `tests/unit/test_plan_runtime.py` | `desktop/src/renderer/src/runtime/planProjection.test.ts`, `packages/core/src/runtime/runtime.test.ts` |
| `tests/unit/test_plan_store.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_task_binding.py` | `packages/core/src/plans/plans.test.ts`, `packages/core/src/tasks/tasks.test.ts` |
| `tests/unit/test_plan_verification.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_plan_verification_matrix.py` | `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_project_session_memory.py` | `packages/core/src/sessions/sessions.test.ts`, `packages/core/src/agent/loop.test.ts` |
| `tests/unit/test_project_store.py` | `packages/core/src/tasks/tasks.test.ts`, `packages/core/src/agent/loop.test.ts` |
| `tests/unit/test_providers.py` | `packages/core/src/providers/providers.test.ts`, `packages/core/src/providers/registry.test.ts` |
| `tests/unit/test_query_state.py` | `packages/core/src/agent/query-state.test.ts`, `packages/core/src/agent/loop.test.ts` |
| `tests/unit/test_reviewer_verdict.py` | `desktop/src/renderer/src/runtime/projectExecution.test.ts`, `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_run_command_readonly.py` | `packages/core/src/tools.test.ts`, `packages/core/src/permissions/permissions.test.ts` |
| `tests/unit/test_runner_behavior_contract.py` | `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_runner_state.py` | `packages/core/src/agent/runner.test.ts` |
| `tests/unit/test_runtime_events.py` | `packages/core/src/runtime/runtime.test.ts`, `desktop/src/renderer/src/runtime/chatProjection.test.ts`, `desktop/src/renderer/src/composables/useRuntime.test.ts` |
| `tests/unit/test_scheduler_api.py` | `packages/core/src/api/core-api.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_scheduler_executor.py` | `packages/core/src/scheduler/executor.test.ts` |
| `tests/unit/test_scheduler_service.py` | `packages/core/src/scheduler/scheduler.test.ts` |
| `tests/unit/test_scheduler_store.py` | `packages/core/src/scheduler/scheduler.test.ts` |
| `tests/unit/test_scheduler_tool.py` | `packages/core/src/scheduler/scheduler.test.ts`, `packages/core/src/tools.test.ts` |
| `tests/unit/test_session_runtime.py` | `packages/core/src/runtime/runtime.test.ts`, `desktop/src/renderer/src/runtime/sessionDrafts.test.ts` |
| `tests/unit/test_session_store.py` | `packages/core/src/sessions/sessions.test.ts` |
| `tests/unit/test_session_title.py` | `packages/core/src/sessions/sessions.test.ts` |
| `tests/unit/test_sessions_api.py` | `packages/core/src/api/core-api.test.ts`, `desktop/src/renderer/src/composables/useSession.test.ts` |
| `tests/unit/test_shell.py` | `packages/core/src/tools.test.ts` |
| `tests/unit/test_sidebar_state.py` | `desktop/src/renderer/src/runtime/sidebarModel.test.ts` |
| `tests/unit/test_sidebar_state_api.py` | `packages/core/src/api/core-api.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_sidechain_transcript.py` | `packages/core/src/tasks/tasks.test.ts` |
| `tests/unit/test_skill_requests.py` | `desktop/src/renderer/src/commands.test.ts`, `packages/core/src/api/services/skill-service.test.ts` |
| `tests/unit/test_skill_service.py` | `packages/core/src/api/services/skill-service.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_subagent_task_sidechain.py` | `packages/core/src/subagents/subagents.test.ts`, `packages/core/src/tasks/tasks.test.ts` |
| `tests/unit/test_task_runtime_api.py` | `packages/core/src/api/core-api.test.ts`, `packages/core/src/tasks/tasks.test.ts` |
| `tests/unit/test_tasks_store.py` | `packages/core/src/tasks/tasks.test.ts` |
| `tests/unit/test_team.py` | `packages/core/src/team/team.test.ts`, `packages/core/src/api/services/team-service.test.ts` |
| `tests/unit/test_todo_tool.py` | `packages/core/src/tools.test.ts`, `packages/core/src/plans/plans.test.ts` |
| `tests/unit/test_token_usage.py` | `packages/core/src/memory/compactor-token.test.ts`, `packages/core/src/api/services/memory-service.test.ts` |
| `tests/unit/test_tool_descriptions.py` | `packages/core/src/tools.test.ts` |
| `tests/unit/test_tool_execution_engine.py` | `packages/core/src/tools.test.ts` |
| `tests/unit/test_tool_protocol_v2.py` | `packages/core/src/tools.test.ts`, `packages/core/src/tools-and-context.test.ts` |
| `tests/unit/test_tool_result_store.py` | `packages/core/src/tools-and-context.test.ts` |
| `tests/unit/test_watchlist.py` | `packages/core/src/watchlist/watchlist.test.ts`, `packages/core/src/scheduler/executor.test.ts` |
| `tests/unit/test_web_api_only.py` | `packages/core/src/api/core-api.test.ts`, `desktop/src/renderer/src/api/http.test.ts` |
| `tests/unit/test_web_diagnostics.py` | `packages/core/src/api/services/diagnostics-service.test.ts`, `desktop/src/renderer/src/components/panels/diagnosticsPanelModel.test.ts` |
| `tests/unit/test_web_fetch.py` | `packages/core/src/tools.test.ts` |
| `tests/unit/test_web_mutation_guard.py` | `packages/core/src/api/mutation-guard.test.ts`, `packages/core/src/api/core-api.test.ts` |
| `tests/unit/test_web_plans_api.py` | `packages/core/src/api/core-api.test.ts`, `desktop/src/renderer/src/runtime/planProjection.test.ts` |
| `tests/unit/test_workspace_context.py` | `packages/core/src/agent/context-builder.test.ts`, `packages/core/src/agent/loop.test.ts` |

Notes:

- `test_auth_guard.py` and `test_origin_guard.py` are intentionally mapped to IPC/topology tests because the HTTP server attack surface is retired in the default desktop runtime.
- The map is file-level and now acts as the frozen source inventory after `tests/` retirement.
- Some Python files contain multiple test cases; the final REL-004 audit must confirm behavior-level coverage before marking done.
