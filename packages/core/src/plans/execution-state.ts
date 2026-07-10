/**
 * PlanExecutionState (MIG-CTRL-013)。对齐 Python `agent/plans/execution.py`。
 * start_next_step / complete_step / fail_step 的不可变状态机。
 */
import { nowTs } from '../util/time'
import {
  PlanStatus,
  PlanStepStatus,
  type PlanRecord,
  type PlanStep,
} from './models'

export class PlanExecutionState {
  readonly plan: PlanRecord

  constructor(plan: PlanRecord) {
    this.plan = plan
  }

  startNextStep(): PlanRecord {
    if (this.plan.steps.some((step) => step.status === PlanStepStatus.ACTIVE)) {
      return this.plan
    }
    const steps: PlanStep[] = []
    let activated = false
    for (const step of this.plan.steps) {
      if (!activated && step.status === PlanStepStatus.PENDING) {
        steps.push({ ...step, status: PlanStepStatus.ACTIVE })
        activated = true
      } else {
        steps.push(step)
      }
    }
    return {
      ...this.plan,
      status: PlanStatus.EXECUTING,
      updatedAt: nowTs(),
      steps,
    }
  }

  completeStep(
    stepId: string,
    opts: { evidence: Record<string, unknown> },
  ): PlanRecord {
    const steps = this.plan.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status: PlanStepStatus.DONE,
            evidence: [...step.evidence, opts.evidence],
          }
        : step,
    )
    const allDone =
      steps.length > 0 &&
      steps.every((step) => step.status === PlanStepStatus.DONE)
    const status = allDone ? PlanStatus.COMPLETED : PlanStatus.EXECUTING
    return {
      ...this.plan,
      status,
      completedAt:
        status === PlanStatus.COMPLETED ? nowTs() : this.plan.completedAt,
      updatedAt: nowTs(),
      steps,
    }
  }

  failStep(
    stepId: string,
    opts: { evidence: Record<string, unknown> },
  ): PlanRecord {
    const steps = this.plan.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status: PlanStepStatus.FAILED,
            evidence: [...step.evidence, opts.evidence],
          }
        : step,
    )
    return {
      ...this.plan,
      status: PlanStatus.FAILED,
      updatedAt: nowTs(),
      steps,
    }
  }
}
