import { describe, expect, it } from 'vitest'
import {
  IDLE_BANTER,
  IDLE_BUBBLE_DURATION_MS,
  IDLE_BUBBLE_INTERVAL_MS,
  IDLE_SCENES,
  IDLE_SLEEP_DURATION_MS,
  idleSceneAt,
} from '../idle-scenes.js'

describe('idle-scenes', () => {
  it('uses richer idle timing and enough local banter', () => {
    expect(IDLE_BUBBLE_INTERVAL_MS).toBe(25000)
    expect(IDLE_BUBBLE_DURATION_MS).toBe(6000)
    expect(IDLE_SLEEP_DURATION_MS).toBe(8000)
    expect(IDLE_BANTER.length).toBeGreaterThanOrEqual(30)
  })

  it('rotates idle-only assets and keeps sleeping short', () => {
    const animations = IDLE_SCENES.map((scene) => scene.animation)
    expect(new Set(animations)).toEqual(new Set(['idle', 'sweeping', 'sleeping']))
    expect(animations.includes('thinking')).toBe(false)
    expect(animations.includes('happy')).toBe(false)
    expect(animations.includes('notification')).toBe(false)
    expect(animations.includes('dizzy')).toBe(false)
    expect(animations.includes('disconnected')).toBe(false)

    const sleeping = IDLE_SCENES.find((scene) => scene.animation === 'sleeping')
    expect(sleeping!.durationMs).toBe(8000)
    expect(sleeping!.wakeAnimation).toBe('idle')
  })

  it('provides deterministic idle scenes with clipped display durations', () => {
    const first = idleSceneAt(0)
    const sleeping = idleSceneAt(6)
    const wrapped = idleSceneAt(IDLE_SCENES.length)

    expect(first.animation).toBe('idle')
    expect(first.bubbleDurationMs).toBe(6000)
    expect(typeof first.bubble).toBe('string')
    expect(first.bubble.length).toBeGreaterThan(0)
    expect(sleeping.animation).toBe('sleeping')
    expect(sleeping.durationMs).toBe(8000)
    expect(wrapped.animation).toBe(first.animation)
  })
})
