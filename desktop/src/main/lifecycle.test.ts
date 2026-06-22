import { describe, it, expect } from 'vitest'
import { planStartup, planShutdown } from './lifecycle'

describe('planStartup', () => {
  it('attaches to an already-healthy backend without owning it', () => {
    expect(planStartup({ alreadyHealthy: true })).toEqual({ action: 'attach', ownsBackend: false })
  })

  it('spawns and owns the backend when nothing is running', () => {
    expect(planStartup({ alreadyHealthy: false })).toEqual({ action: 'spawn', ownsBackend: true })
  })
})

describe('planShutdown', () => {
  it('kills only a backend we own and actually spawned', () => {
    const child = { pid: 123 }
    expect(planShutdown({ ownsBackend: true, child })).toEqual({ shouldKill: true })
    expect(planShutdown({ ownsBackend: false, child })).toEqual({ shouldKill: false })
    expect(planShutdown({ ownsBackend: true, child: null })).toEqual({ shouldKill: false })
  })
})
