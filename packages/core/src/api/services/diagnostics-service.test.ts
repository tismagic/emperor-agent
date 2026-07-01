import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoreDiagnosticsService } from './diagnostics-service'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('CoreDiagnosticsService (MIG-IPC-007 / MIG-APP-002)', () => {
  it('summarizes diagnostics without mutating missing or corrupt config files', async () => {
    const root = tmp('emperor-diagnostics-service-')
    writeFileSync(join(root, 'emperor.local.json'), '{bad json', 'utf8')
    writeFileSync(join(root, 'emperor.local.json.corrupt-1'), '{old bad json', 'utf8')
    mkdirSync(join(root, 'desktop', 'out', 'renderer'), { recursive: true })
    writeFileSync(join(root, 'desktop', 'out', 'renderer', 'index.html'), '<html></html>', 'utf8')
    const service = new CoreDiagnosticsService(root, {
      schedulerDiagnostics: () => ({ jobsFile: join(root, 'memory', 'scheduler', 'jobs.json') }),
      runtimeStats: () => ({ events: 2, archiveFiles: 1 }),
      externalPayload: () => ({ running: true, store: { exists: true } }),
      activeTasks: () => [{ id: 'turn:1', status: 'running' }],
      desktopPetPayload: async () => ({ enabled: false, running: false }),
    })

    const payload = await service.payload()

    expect(existsSync(join(root, 'model_config.json'))).toBe(false)
    expect(existsSync(join(root, 'emperor.local.json'))).toBe(true)
    expect(payload.modelConfig).toMatchObject({
      path: join(root, 'model_config.json'),
      exists: false,
      status: 'missing',
      error: '',
    })
    expect(payload.localConfig).toMatchObject({
      path: join(root, 'emperor.local.json'),
      exists: true,
      status: 'corrupt',
    })
    expect((payload.localConfig as any).corruptBackups).toEqual([
      expect.objectContaining({ path: join(root, 'emperor.local.json.corrupt-1') }),
    ])
    expect(payload.scheduler).toMatchObject({ jobsFile: join(root, 'memory', 'scheduler', 'jobs.json') })
    expect(payload.runtime).toMatchObject({ events: 2, archiveFiles: 1 })
    expect(payload.external).toMatchObject({ running: true })
    expect(payload.activeTasks).toHaveLength(1)
    expect(payload.desktopPet).toMatchObject({ enabled: false, running: false })
    expect(payload.dependencies).toMatchObject({
      nodeRuntime: true,
      desktopRenderer: true,
      desktopPetNodeModules: false,
    })
  })
})
