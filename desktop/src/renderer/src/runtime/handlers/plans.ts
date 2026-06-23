import type { RuntimePlanRecord, RuntimePlanStep, WsEvent } from '../../types'

export interface PlanProjection {
  plans: RuntimePlanRecord[]
}

type PlanEvent = Extract<WsEvent, {
  event: 'plan_runtime_update' | 'plan_step_update' | 'plan_verification_start' | 'plan_verification_done'
}>

export function applyPlanEvent(projection: PlanProjection, event: PlanEvent): PlanProjection {
  if (event.event === 'plan_runtime_update') {
    if (!event.plan?.id) return projection
    const existing = projection.plans.findIndex((plan) => plan.id === event.plan?.id)
    const plans = [...projection.plans]
    if (existing >= 0) plans[existing] = { ...plans[existing], ...event.plan }
    else plans.push(event.plan)
    return { plans }
  }

  const planId = event.plan_id
  if (!planId) return projection
  return {
    plans: projection.plans.map((plan) => {
      if (plan.id !== planId) return plan
      if (event.event === 'plan_step_update' && event.step?.id) {
        return { ...plan, steps: upsertStep(plan.steps || [], event.step) }
      }
      if (event.event === 'plan_verification_done' && event.step_id && event.result) {
        return {
          ...plan,
          steps: (plan.steps || []).map((step) =>
            step.id === event.step_id
              ? { ...step, evidence: [...(step.evidence || []), event.result || {}] }
              : step,
          ),
        }
      }
      return plan
    }),
  }
}

function upsertStep(steps: RuntimePlanStep[], step: RuntimePlanStep): RuntimePlanStep[] {
  const existing = steps.findIndex((item) => item.id === step.id)
  const next = [...steps]
  if (existing >= 0) next[existing] = { ...next[existing], ...step }
  else next.push(step)
  return next
}
