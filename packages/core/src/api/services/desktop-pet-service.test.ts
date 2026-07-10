import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoreDesktopPetService } from './desktop-pet-service'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('CoreDesktopPetService', () => {
  it('persists enabled preference and reports running state', async () => {
    const root = tmp('emperor-pet-service-')
    const stateRoot = tmp('emperor-pet-service-state-')
    const service = new CoreDesktopPetService(root, { stateRoot })

    const enabled = await service.setEnabled(true)

    expect(enabled).toMatchObject({
      enabled: true,
      running: true,
      managedBy: 'Electron main process',
      available: true,
    })
    expect(enabled.pid).toBeNull()
    expect(enabled.lastError).toBeNull()
    expect(enabled.installCommand).toBe('')
    expect(
      readFileSync(join(stateRoot, 'emperor.local.json'), 'utf8'),
    ).toContain('"enabled": true')
    expect((await service.get()).enabled).toBe(true)

    const disabled = await service.setEnabled(false)

    expect(disabled).toMatchObject({
      enabled: false,
      running: false,
      lastError: null,
    })
    expect(
      readFileSync(join(stateRoot, 'emperor.local.json'), 'utf8'),
    ).toContain('"enabled": false')
  })

  it('marks stopped and error state', async () => {
    const root = tmp('emperor-pet-service-state-')
    const stateRoot = tmp('emperor-pet-service-state2-')
    const service = new CoreDesktopPetService(root, { stateRoot })

    // Enable first
    await service.setEnabled(true)
    expect((await service.get()).running).toBe(true)

    // Mark stopped
    service.markStopped()
    expect((await service.get()).running).toBe(false)

    // Mark error
    service.markError('something went wrong')
    const afterError = await service.get()
    expect(afterError.running).toBe(false)
    expect(afterError.lastError).toBe('something went wrong')
  })

  it('runs mutation checks synchronously before toggling', () => {
    const service = new CoreDesktopPetService(
      tmp('emperor-pet-service-guard-'),
      {
        assertMutation: () => {
          throw new Error('blocked')
        },
      },
    )

    expect(() => service.setEnabled(true)).toThrow('blocked')
  })
})
