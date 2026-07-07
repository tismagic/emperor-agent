import { describe, expect, it, vi } from 'vitest'
import { channelForCoreOperation } from '../shared/ipc-contract'
import { registerCoreIpc } from './ipc'

describe('core IPC bridge (MIG-IPC-002)', () => {
  it('derives stable namespaced channels from CoreApi operation keys', () => {
    expect(channelForCoreOperation('bootstrap')).toBe('emperor:core:bootstrap')
    expect(channelForCoreOperation('sessions.create')).toBe('emperor:core:sessions:create')
    expect(channelForCoreOperation('chat.submit')).toBe('emperor:core:chat:submit')
  })

  it('registers handlers that invoke the matching CoreApi method', async () => {
    const ipc = new FakeIpcMain()
    const api = {
      sessions: {
        create: (opts: Record<string, unknown>) => ({ id: 's1', ...opts }),
      },
      bootstrap: () => ({ app: 'Emperor Agent' }),
    }

    registerCoreIpc(ipc, api, ['sessions.create', 'bootstrap'])

    expect(ipc.channels()).toEqual(['emperor:core:bootstrap', 'emperor:core:sessions:create'])
    await expect(ipc.invoke('emperor:core:sessions:create', { title: '新会话' })).resolves.toEqual({ id: 's1', title: '新会话' })
    await expect(ipc.invoke('emperor:core:bootstrap')).resolves.toEqual({ app: 'Emperor Agent' })
  })

  it('invokes prototype operations with their owning receiver', async () => {
    const ipc = new FakeIpcMain()
    class Api {
      readonly app = 'Emperor Agent'

      bootstrap() {
        return { app: this.app }
      }
    }
    registerCoreIpc(ipc, new Api() as unknown as Record<string, unknown>, ['bootstrap'])

    await expect(ipc.invoke('emperor:core:bootstrap')).resolves.toEqual({ app: 'Emperor Agent' })
  })

  it('maps thrown implementation errors to safe renderer payloads', async () => {
    const ipc = new FakeIpcMain()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerCoreIpc(ipc, { model: { test: () => { throw new Error('secret stack details') } } }, ['model.test'])

    const payload = await ipc.invoke('emperor:core:model:test', {})

    expect(payload).toMatchObject({ ok: false, error: { message: 'Internal error' } })
    expect(String(payload.error.errorId)).toMatch(/^ipc_/)
    expect(JSON.stringify(payload)).not.toContain('secret stack details')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[core-ipc\] model\.test failed \(ipc_[a-z0-9]+\)$/),
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it('passes safe domain errors through the IPC boundary', async () => {
    const ipc = new FakeIpcMain()
    const error = Object.assign(new Error('还没有可用模型，请先配置模型。'), {
      code: 'model_configuration_required',
      action: 'open_model_settings',
      toSafe: () => ({
        code: 'model_configuration_required',
        message: '还没有可用模型，请先配置模型。',
        action: 'open_model_settings',
      }),
    })
    registerCoreIpc(ipc, { chat: { submit: () => { throw error } } }, ['chat.submit'])

    await expect(ipc.invoke('emperor:core:chat:submit', {})).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'model_configuration_required',
        message: '还没有可用模型，请先配置模型。',
        action: 'open_model_settings',
      },
    })
  })

  it('preserves benign turn interruption codes for renderer control flow', async () => {
    const ipc = new FakeIpcMain()
    const turnPaused = new Error('turn paused for ask: ask_1')
    turnPaused.name = 'TurnPaused'
    const cancelled = new Error('active task cancelled: turn_1')
    cancelled.name = 'CancelledTaskError'
    const busy = new Error('Another agent turn is already running')
    busy.name = 'TurnBusyError'
    registerCoreIpc(ipc, {
      chat: {
        submit: () => { throw turnPaused },
        stopRuntime: () => { throw cancelled },
        busy: () => { throw busy },
      },
    }, ['chat.submit', 'chat.stopRuntime', 'chat.busy'])

    await expect(ipc.invoke('emperor:core:chat:submit', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'turn_paused', message: 'Turn paused' },
    })
    await expect(ipc.invoke('emperor:core:chat:stopRuntime', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'cancelled', message: 'Task cancelled' },
    })
    await expect(ipc.invoke('emperor:core:chat:busy', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'turn_busy', message: 'Another agent turn is already running' },
    })
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

  async invoke(channel: string, ...args: unknown[]): Promise<any> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`missing handler: ${channel}`)
    return handler({}, ...args)
  }
}
