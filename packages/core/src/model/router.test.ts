import { describe, expect, it } from 'vitest'
import { roughTokenEstimate } from './router'

describe('roughTokenEstimate', () => {
  it('returns >= 1, roughly chars/3', () => {
    expect(roughTokenEstimate('')).toBe(1)
    expect(roughTokenEstimate('hello')).toBe(1)
    expect(roughTokenEstimate('123456')).toBe(2)
  })
})
