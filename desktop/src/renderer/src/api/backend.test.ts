import { describe, it, expect, afterEach } from 'vitest'
import { backendBase, apiUrl, wsUrl } from './backend'

const g = globalThis as unknown as { window?: unknown }

afterEach(() => {
  delete g.window
})

describe('with an injected backend base url', () => {
  it('builds absolute api and ws urls', () => {
    g.window = { emperor: { backendBaseUrl: 'http://127.0.0.1:8765' } }
    expect(backendBase()).toBe('http://127.0.0.1:8765')
    expect(apiUrl('/api/bootstrap')).toBe('http://127.0.0.1:8765/api/bootstrap')
    expect(wsUrl('/ws?x=1')).toBe('ws://127.0.0.1:8765/ws?x=1')
  })
})

describe('without an injected backend base url (same-origin fallback)', () => {
  it('keeps api paths relative and derives ws from location', () => {
    g.window = { location: { protocol: 'http:', host: 'localhost:5173' } }
    expect(backendBase()).toBe('')
    expect(apiUrl('/api/bootstrap')).toBe('/api/bootstrap')
    expect(wsUrl('/ws?x=1')).toBe('ws://localhost:5173/ws?x=1')
  })
})
