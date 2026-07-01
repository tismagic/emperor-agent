import { describe, expect, it } from 'vitest'
import { createCoreBridge } from './core-ipc'

describe('preload core IPC bridge (MIG-IPC-002)', () => {
  it('invokes namespaced CoreApi channels by operation key', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const bridge = createCoreBridge({
      invoke: async (channel, ...args) => {
        calls.push({ channel, args })
        return { ok: true }
      },
    })

    await expect(bridge.invokeCore('sessions.create', { title: 'A' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual([{ channel: 'emperor:core:sessions:create', args: [{ title: 'A' }] }])
  })
})
