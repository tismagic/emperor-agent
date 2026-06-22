import { describe, it, expect } from 'vitest'
import { parseBackendArg } from './backend-arg'

describe('parseBackendArg', () => {
  it('extracts the value from --backend-url=', () => {
    expect(parseBackendArg(['--backend-url=http://127.0.0.1:8765'])).toBe('http://127.0.0.1:8765')
  })

  it('returns empty string when the flag is absent', () => {
    expect(parseBackendArg(['--something-else'])).toBe('')
    expect(parseBackendArg([])).toBe('')
  })
})
