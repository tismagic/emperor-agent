import { describe, expect, it } from 'vitest'
import { ModelRouter, roughTokenEstimate, type ProviderSnapshot } from './router'

describe('roughTokenEstimate', () => {
  it('returns >= 1, roughly chars/3', () => {
    expect(roughTokenEstimate('')).toBe(1)
    expect(roughTokenEstimate('hello')).toBe(1)
    expect(roughTokenEstimate('123456')).toBe(2)
  })
})

describe('hook model routing', () => {
  it('routes hook use cases to secondary with main fallback by default', () => {
    const router = routerWithSnapshots()

    const prompt = router.route('hook_prompt', null, 'check this')
    const agent = router.route('hook_agent', null, 'inspect this')

    expect(prompt.snapshot.model).toBe('secondary-model')
    expect(prompt.fallback?.model).toBe('main-model')
    expect(prompt.useCase).toBe('hook_prompt')
    expect(agent.snapshot.model).toBe('secondary-model')
    expect(agent.fallback?.model).toBe('main-model')
  })

  it('honors an explicit main role without secondary fallback', () => {
    const router = routerWithSnapshots()

    const route = router.routeForRole('hook_prompt', 'main', 'check this')

    expect(route.snapshot.model).toBe('main-model')
    expect(route.fallback).toBeNull()
    expect(route.useCase).toBe('hook_prompt')
    expect(route.reason).toContain('explicit_main')
  })
})

function routerWithSnapshots(): ModelRouter {
  const main = { model: 'main-model', modelRole: 'main', contextWindowTokens: 200_000 } as ProviderSnapshot
  const secondary = { model: 'secondary-model', modelRole: 'secondary', contextWindowTokens: 64_000 } as ProviderSnapshot
  return Object.assign(Object.create(ModelRouter.prototype) as ModelRouter, { main, secondary })
}
