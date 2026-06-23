import { describe, expect, it } from 'vitest'
import { applyPlanEvent, type PlanProjection } from './handlers/plans'

describe('plan projection', () => {
  it('updates step status and verification evidence', () => {
    let projection: PlanProjection = { plans: [] }
    projection = applyPlanEvent(projection, {
      event: 'plan_runtime_update',
      plan: {
        id: 'plan_1',
        title: 'Build feature',
        status: 'executing',
        steps: [{ id: 'step_1', title: 'Run tests', status: 'active' }],
      },
    })
    projection = applyPlanEvent(projection, {
      event: 'plan_verification_done',
      plan_id: 'plan_1',
      step_id: 'step_1',
      result: { command: 'pytest', passed: true, summary: '2 passed' },
    })

    expect(projection.plans[0]?.steps[0]?.status).toBe('active')
    expect(projection.plans[0]?.steps[0]?.evidence?.[0]?.summary).toBe('2 passed')
  })
})
