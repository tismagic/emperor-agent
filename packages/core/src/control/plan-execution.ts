/**
 * PlanExecutionManager (MIG-CTRL-007)。对齐 Python `agent/control/plan_execution.py`。
 * approved→executing 激活、legacy todo→step 投影、step 任务同步、工具输出 sidechain。
 * task_manager 为 null 时（W14 未迁移）所有任务绑定逻辑 no-op —— 与 Python 一致。
 */
import { nowTs } from '../util/time'
import {
  PlanDraftPhase,
  PlanStatus,
  PlanStepStatus,
  planFromDict,
  planToDict,
  type PlanRecord,
  type PlanStep,
} from '../plans/models'
import { PlanExecutionState } from '../plans/execution-state'
import type { Interaction } from './models'
import { plansShareFullGoalScope } from '../goals/scope'
import {
  metadataWithoutPlanPermissionTokens,
  planStatusFromTodo,
  stepVerificationStatus,
  taskStatusFromPlanStep,
} from './plan-helpers'
import type { ControlManagerHost } from './host'

const TASK_KIND_PLAN_STEP = 'plan_step' // agent/tasks TaskKind.PLAN_STEP
const TASK_STATUS_FAILED = 'failed'

export class PlanExecutionManager {
  private readonly cm: ControlManagerHost
  constructor(cm: ControlManagerHost) {
    this.cm = cm
  }

  /**
   * Legacy todo→plan step 投影。Claude Code-style `update_todos` 主链路不调用这里；
   * 保留是为了旧历史、旧测试和显式兼容 API 能读取/投影旧计划状态。
   */
  syncPlanFromTodos(
    todos: Array<Record<string, unknown>>,
    opts?: { evidence?: Record<string, unknown> | null },
  ): PlanRecord | null {
    const record = this.cm.latestExecutablePlan()
    if (record === null || !record.steps.length) return null
    const evidence = opts?.evidence ?? null
    if (record.goalId !== null) {
      const activeGoal = this.cm.activeGoalPlanContext()
      const generation = Number(record.metadata.approval_generation ?? 0)
      if (!activeGoal || activeGoal.id !== record.goalId)
        throw new Error('Goal Todo binding does not match the current Goal')
      for (const item of todos) {
        if (
          String(item.plan_id ?? '').trim() !== record.id ||
          !Number.isInteger(Number(item.approval_generation)) ||
          Number(item.approval_generation) !== generation
        )
          throw new Error(
            'Goal Todo binding must match current plan_id and approval_generation',
          )
      }
    }
    const todoByStepId = new Map<string, Record<string, unknown>>()
    for (const item of todos) {
      if (!item || typeof item !== 'object') continue
      const stepId = String(item.plan_step_id ?? '').trim()
      if (!stepId)
        throw new Error('todo plan_step_id is required for Plan projection')
      if (!record.steps.some((step) => step.id === stepId))
        throw new Error(`unknown todo plan_step_id: ${stepId}`)
      if (todoByStepId.has(stepId))
        throw new Error(`duplicate todo plan_step_id: ${stepId}`)
      todoByStepId.set(stepId, item)
    }
    const now = nowTs()
    let updated = record
    for (const originalStep of record.steps) {
      const todo = todoByStepId.get(originalStep.id)
      if (todo === undefined) continue
      const todoStatus = String(todo.status ?? 'pending')
      const nextStatus = planStatusFromTodo(todoStatus)
      const currentStep = updated.steps.find(
        (step) => step.id === originalStep.id,
      )!
      if (currentStep.status === nextStatus) continue
      const transitionEvidence = {
        ...(evidence ?? {}),
        todo_id: todo.id,
        plan_step_id: originalStep.id,
        todo_status: todoStatus,
        ...(nextStatus === PlanStepStatus.BLOCKED
          ? { blocked_reason: String(todo.blocked_reason ?? '').trim() }
          : {}),
        synced_at: now,
      }
      if (
        (nextStatus === PlanStepStatus.ACTIVE ||
          nextStatus === PlanStepStatus.DONE) &&
        currentStep.status === PlanStepStatus.PENDING
      ) {
        updated = new PlanExecutionState(updated).startNextStep()
      }
      const active = updated.steps.find((step) => step.id === originalStep.id)!
      if (nextStatus === PlanStepStatus.DONE) {
        updated = new PlanExecutionState(updated).completeStep(
          originalStep.id,
          {
            evidence: transitionEvidence,
          },
        )
      } else if (nextStatus === PlanStepStatus.BLOCKED) {
        updated = new PlanExecutionState(updated).blockStep(originalStep.id, {
          evidence: transitionEvidence,
        })
      } else if (
        nextStatus === PlanStepStatus.ACTIVE &&
        active.status !== PlanStepStatus.ACTIVE
      ) {
        throw new Error(
          `plan step ${originalStep.id} dependencies are not satisfied`,
        )
      } else if (nextStatus === PlanStepStatus.PENDING) {
        throw new Error('todo projection cannot move a Plan step backwards')
      }
    }
    updated = { ...updated, updatedAt: now }
    updated = this.syncPlanStepTasks(updated)
    return this.cm.planStore.save(updated)
  }

  /** 批准新计划时取代同 store 内滞留的 approved/executing 旧计划，防止僵尸累积（B1）。 */
  supersedeStaleExecutingPlans(newPlanId: string): void {
    const successor = this.cm.planStore.get(newPlanId)
    if (successor === null) throw new Error('successor Plan does not exist')
    const now = nowTs()
    for (const record of this.cm.planStore.list()) {
      if (record.id === newPlanId) continue
      if (
        record.status !== PlanStatus.APPROVED &&
        record.status !== PlanStatus.EXECUTING
      )
        continue
      if (
        record.goalId !== successor.goalId ||
        !plansShareFullGoalScope(record, successor)
      )
        continue
      const taskMap =
        record.metadata.plan_step_tasks &&
        typeof record.metadata.plan_step_tasks === 'object' &&
        !Array.isArray(record.metadata.plan_step_tasks)
          ? {
              ...(record.metadata.plan_step_tasks as Record<string, string>),
            }
          : {}
      const metadata = metadataWithoutPlanPermissionTokens(record.metadata, {
        reason: 'Plan superseded by an approved successor',
      })
      metadata.plan_step_tasks_revoked = taskMap
      metadata.plan_step_tasks = {}
      metadata.superseded_by = newPlanId
      metadata.superseded_at = now
      metadata.supersession_audit = {
        predecessor_plan_id: record.id,
        successor_plan_id: newPlanId,
        goal_id: successor.goalId,
      }
      // 不碰 updatedAt：取代是记账而非活动，latest() 必须继续指向新计划
      this.cm.planStore.save({
        ...record,
        status: PlanStatus.CANCELLED,
        metadata,
      })
      for (const taskId of Object.values(taskMap))
        this.cm.taskManager?.cancelTask(taskId, {
          reason: 'Plan superseded by an approved successor',
        })
    }
  }

  recordPlanStepToolOutput(opts: {
    toolName: string
    summary: string
    toolCallId?: string | null
    artifacts?: Array<Record<string, unknown>> | null
    metadata?: Record<string, unknown> | null
    isError?: boolean
  }): unknown {
    const [record, step, taskId] = this.activePlanStepTask()
    if (
      record === null ||
      step === null ||
      taskId === null ||
      this.cm.taskManager === null
    )
      return null
    const message = {
      kind: 'tool_output',
      role: 'tool',
      plan_id: record.id,
      plan_step_id: step.id,
      tool_name: String(opts.toolName ?? ''),
      tool_call_id: opts.toolCallId ?? null,
      content: String(opts.summary ?? '').slice(0, 2000),
      artifacts: opts.artifacts ?? [],
      metadata: opts.metadata ?? {},
      is_error: Boolean(opts.isError),
    }
    this.cm.taskManager.appendSidechain(taskId, message)
    const task = this.cm.taskManager.store.get(taskId)
    const progress = task !== null ? { ...task.progress } : {}
    progress.last_tool = String(opts.toolName ?? '')
    progress.last_summary = String(opts.summary ?? '').slice(0, 500)
    progress.last_tool_call_id = opts.toolCallId ?? null
    return this.cm.taskManager.updateTask(taskId, { progress })
  }

  private syncPlanStepTasks(record: PlanRecord): PlanRecord {
    if (this.cm.taskManager === null || !record.steps.length) return record
    const mapping = {
      ...((record.metadata.plan_step_tasks as Record<string, string>) ?? {}),
    }
    const scope = planStepTaskScope(record, this.cm.planScopeMetadata())
    record.steps.forEach((step, idx) => {
      const index = idx + 1
      const metadata = {
        plan_id: record.id,
        plan_step_id: step.id,
        approval_generation: Number(record.metadata.approval_generation ?? 0),
        sequence: index,
        verification_status: stepVerificationStatus(step),
        ...(scope ? { scope } : {}),
      }
      const taskId = String(mapping[step.id] ?? '')
      const status = taskStatusFromPlanStep(step.status)
      if (taskId && this.cm.taskManager!.store.get(taskId) !== null) {
        const task = this.cm.taskManager!.store.get(taskId)
        const progress = task !== null ? { ...task.progress } : {}
        progress.verification_status = metadata.verification_status
        this.cm.taskManager!.updateTask(taskId, {
          status,
          title: step.title,
          metadata,
          progress,
        })
        return
      }
      const task = this.cm.taskManager!.startTask({
        kind: TASK_KIND_PLAN_STEP,
        title: step.title,
        source: 'plan_step',
        status,
        sessionId:
          record.sessionId ??
          (this.cm.planScopeMetadata()?.session_id as string | undefined) ??
          null,
        metadata,
      })
      mapping[step.id] = task.id
    })
    const metadata = { ...record.metadata }
    metadata.plan_step_tasks = mapping
    return { ...record, metadata }
  }

  private activePlanStepTask(): [
    PlanRecord | null,
    PlanStep | null,
    string | null,
  ] {
    const record = this.cm.latestExecutablePlan()
    if (record === null) return [null, null, null]
    const mapping = record.metadata.plan_step_tasks
    if (!mapping || typeof mapping !== 'object') return [record, null, null]
    for (const step of record.steps) {
      if (step.status !== PlanStepStatus.ACTIVE) continue
      const taskId = String((mapping as Record<string, string>)[step.id] ?? '')
      return [record, step, taskId || null]
    }
    return [record, null, null]
  }

  appendPlanStepVerification(
    record: PlanRecord,
    opts: { stepId: string; result: Record<string, unknown> },
  ): void {
    if (this.cm.taskManager === null) return
    const mapping = record.metadata.plan_step_tasks
    if (!mapping || typeof mapping !== 'object') return
    const taskId = String(
      (mapping as Record<string, string>)[opts.stepId] ?? '',
    )
    if (!taskId) return
    const passed = opts.result.passed
    const verificationStatus =
      passed === true ? 'passed' : passed === false ? 'failed' : 'unknown'
    this.cm.taskManager.appendSidechain(taskId, {
      kind: 'verification',
      role: 'tool',
      plan_id: record.id,
      plan_step_id: opts.stepId,
      tool_name: String(opts.result.source ?? 'run_command'),
      command: String(opts.result.command ?? ''),
      content: String(opts.result.summary ?? opts.result.error ?? '').slice(
        0,
        2000,
      ),
      passed,
      result: { ...opts.result },
    })
    const task = this.cm.taskManager.store.get(taskId)
    const progress = task !== null ? { ...task.progress } : {}
    progress.verification_status = verificationStatus
    progress.last_verification = { ...opts.result }
    const fields: Record<string, unknown> = { progress }
    if (passed === false) fields.status = TASK_STATUS_FAILED
    this.cm.taskManager.updateTask(taskId, fields)
  }

  updatePlanStatus(
    interaction: Interaction,
    status: string,
    opts?: { approved?: boolean },
  ): PlanRecord | null {
    const planId = String(interaction.meta.plan_id ?? '')
    if (!planId) return null
    const record = this.cm.planStore.get(planId)
    if (record === null) return null
    const now = nowTs()
    let draft = record.draft
    if (opts?.approved) draft = { ...draft, phase: PlanDraftPhase.APPROVED }
    const scope = this.cm.planScopeMetadata()
    const metadata = {
      ...record.metadata,
      ...(scope && !record.metadata.scope ? { scope } : {}),
    }
    const payload: Record<string, unknown> = {
      ...planToDict(record),
      status,
      updated_at: now,
      draft: {
        ...(planToDict({ ...record, draft }).draft as Record<string, unknown>),
      },
      metadata,
    }
    if (opts?.approved) payload.approved_at = now
    return this.cm.planStore.save(planFromDict(payload))
  }

  activateApprovedPlan(interaction: Interaction): PlanRecord | null {
    const planId = String(interaction.meta.plan_id ?? '')
    if (!planId) return null
    const record = this.cm.planStore.get(planId)
    if (record === null) return null
    if (this.cm.todoStore === null || !record.steps.length) return record
    let activated = new PlanExecutionState(record).startNextStep()
    activated = {
      ...activated,
      draft: { ...activated.draft, phase: PlanDraftPhase.EXECUTING },
    }
    activated = this.cm.permissionTokens.issue(activated)
    activated = this.syncPlanStepTasks(activated)
    return this.cm.planStore.save(activated)
  }
}

function planStepTaskScope(
  record: PlanRecord,
  current: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const saved = record.metadata.scope
  if (saved && typeof saved === 'object' && !Array.isArray(saved))
    return { ...(saved as Record<string, unknown>) }
  return current ? { ...current } : null
}
