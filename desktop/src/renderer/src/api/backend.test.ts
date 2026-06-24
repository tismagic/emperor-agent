import { describe, it, expect, afterEach } from 'vitest'
import { backendBase, apiUrl, wsUrl, getBackendToken } from './backend'

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

describe('with an injected backend token', () => {
  it('appends the token to ws urls (browsers cannot set ws headers)', () => {
    g.window = { emperor: { backendBaseUrl: 'http://127.0.0.1:8765', backendToken: 'tok-9' } }
    expect(getBackendToken()).toBe('tok-9')
    expect(wsUrl('/ws?x=1')).toBe('ws://127.0.0.1:8765/ws?x=1&token=tok-9')
    expect(wsUrl('/ws')).toBe('ws://127.0.0.1:8765/ws?token=tok-9')
  })

  it('omits the token when absent', () => {
    g.window = { emperor: { backendBaseUrl: 'http://127.0.0.1:8765' } }
    expect(getBackendToken()).toBe('')
    expect(wsUrl('/ws?x=1')).toBe('ws://127.0.0.1:8765/ws?x=1')
  })
})
