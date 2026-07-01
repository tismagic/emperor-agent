import { describe, expect, it } from 'vitest'
import { channelForCoreOperation } from '../shared/ipc-contract'
import { coreOperationKeys, registerCoreHostIpc } from './core-host'

describe('desktop CoreApi host (MIG-IPC-002)', () => {
  it('registers every CoreApi operation on the Electron IPC boundary', () => {
    const ipc = new FakeIpcMain()
    registerCoreHostIpc(ipc, { bootstrap: () => ({ app: 'Emperor Agent' }) })

    expect(coreOperationKeys()).toContain('bootstrap')
    expect(coreOperationKeys()).toContain('control.answerInteraction')
    expect(ipc.channels()).toContain(channelForCoreOperation('bootstrap'))
    expect(ipc.channels()).toContain(channelForCoreOperation('control.answerInteraction'))
    expect(ipc.channels()).toHaveLength(coreOperationKeys().length)
  })
})

type Handler = (_event: unknown, ...args: unknown[]) => unknown

class FakeIpcMain {
  private readonly handlers = new Map<string, Handler>()

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler)
  }

  channels(): string[] {
    return [...this.handlers.keys()].sort()
  }
}
