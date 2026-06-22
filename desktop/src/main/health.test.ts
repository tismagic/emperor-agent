import { describe, it, expect } from 'vitest'
import { probeBackend, waitForBackend } from './health'

const BASE = 'http://127.0.0.1:8765'

describe('probeBackend', () => {
  it('returns true on a 2xx response', async () => {
    const calls: string[] = []
    const fetchFn = async (url: string) => {
      calls.push(url)
      return { ok: true } as Response
    }
    expect(await probeBackend(BASE, { fetchFn })).toBe(true)
    expect(calls[0]).toBe(`${BASE}/api/bootstrap`)
  })

  it('returns false on a non-2xx response', async () => {
    const fetchFn = async () => ({ ok: false }) as Response
    expect(await probeBackend(BASE, { fetchFn })).toBe(false)
  })

  it('returns false when fetch rejects', async () => {
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED')
    }
    expect(await probeBackend(BASE, { fetchFn })).toBe(false)
  })
})

describe('waitForBackend', () => {
  it('resolves once a later probe succeeds', async () => {
    let attempts = 0
    const probe = async () => {
      attempts += 1
      return attempts >= 3
    }
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
    }
    await waitForBackend(BASE, { probe, sleep, retries: 5, intervalMs: 250 })
    expect(attempts).toBe(3)
    expect(sleeps.length).toBe(2)
  })

  it('rejects with a readable message after exhausting retries', async () => {
    const probe = async () => false
    const sleep = async () => {}
    await expect(
      waitForBackend(BASE, { probe, sleep, retries: 3, intervalMs: 100 }),
    ).rejects.toThrow(/did not become ready/)
  })
})
