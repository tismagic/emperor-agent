/**
 * PlanQualityGate (MIG-CTRL-013)。对齐 Python `agent/plans/quality.py`。
 * 在计划成为审批卡前拒绝弱计划：scope / 未知 discovery / 泛标题 / 验证 / 高风险 note+rollback。
 */
import type { PlanDraftState, PlanStep } from './models'

export interface PlanQualityResult {
  ok: boolean
  errors: string[]
}

export class PlanQualityError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(formatPlanQualityError(errors))
    this.name = 'PlanQualityError'
    this.errors = [...errors]
  }
}

export class PlanQualityGate {
  assess(opts: {
    steps: PlanStep[]
    draft: PlanDraftState
  }): PlanQualityResult {
    const errors: string[] = []
    if (!opts.steps.length) {
      errors.push('plan has no structured steps')
      return { ok: false, errors }
    }
    const discoveryIds = new Set<string>()
    for (const item of opts.draft.discoveries) {
      if (item && typeof item === 'object') {
        const id = String((item as Record<string, unknown>).id ?? '').trim()
        if (id) discoveryIds.add(id)
      }
    }
    const hasDraftVerification = opts.draft.verificationStrategy.length > 0
    for (const step of opts.steps) {
      errors.push(...assessStep(step, discoveryIds, hasDraftVerification))
    }
    return { ok: errors.length === 0, errors }
  }

  requireOk(opts: { steps: PlanStep[]; draft: PlanDraftState }): void {
    const result = this.assess(opts)
    if (!result.ok) throw new PlanQualityError(result.errors)
  }
}

export function formatPlanQualityError(errors: string[]): string {
  return [
    'Error: plan quality gate failed',
    ...errors.map((e) => `- ${e}`),
  ].join('\n')
}

function assessStep(
  step: PlanStep,
  discoveryIds: Set<string>,
  hasDraftVerification: boolean,
): string[] {
  const sid = step.id
  const errors: string[] = []
  if (!hasScope(step, discoveryIds)) {
    errors.push(
      `${sid} has no target files, discovery reference, or concrete scope`,
    )
  }
  const unknownRefs = step.discoveryRefs.filter(
    (ref) => discoveryIds.size > 0 && !discoveryIds.has(ref),
  )
  if (unknownRefs.length) {
    errors.push(
      `${sid} references unknown discoveries: ${unknownRefs.slice(0, 3).join(', ')}`,
    )
  }
  if (hasGenericTitle(step)) {
    errors.push(`${sid} title is too generic; add concrete acceptance`)
  }
  if (!hasVerification(step, hasDraftVerification)) {
    errors.push(
      `${sid} has no verification command or manual verification rule`,
    )
  }
  if (step.risk.trim().toLowerCase() === 'high') {
    if (!step.riskNote.trim())
      errors.push(`${sid} is high risk but has no risk note`)
    if (!step.rollback.trim())
      errors.push(`${sid} is high risk but has no rollback path`)
  }
  return errors
}

function hasScope(step: PlanStep, discoveryIds: Set<string>): boolean {
  if (step.files.length) return true
  if (
    step.discoveryRefs.length &&
    (discoveryIds.size === 0 ||
      step.discoveryRefs.some((ref) => discoveryIds.has(ref)))
  ) {
    return true
  }
  if (step.acceptance.length) return true
  return step.description.trim().length >= 24
}

const GENERIC_TITLES = new Set([
  'fix issue',
  'fix bug',
  'improve code',
  'update code',
  'make changes',
  'implement',
  'refactor',
  '修复问题',
  '优化代码',
  '改进代码',
])

function hasGenericTitle(step: PlanStep): boolean {
  const title = step.title
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((p) => p)
    .join(' ')
  return GENERIC_TITLES.has(title) && !step.acceptance.length
}

function hasVerification(
  step: PlanStep,
  hasDraftVerification: boolean,
): boolean {
  return Boolean(
    step.commands.length || step.acceptance.length || hasDraftVerification,
  )
}
