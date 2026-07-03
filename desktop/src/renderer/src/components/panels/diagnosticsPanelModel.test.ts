import { describe, expect, it } from 'vitest'
import type { DiagnosticsPayload } from '../../types'
import {
  diagnosticRows,
  diagnosticStatusTone,
  diagnosticStatusText,
} from './diagnosticsPanelModel'

describe('diagnostics panel model', () => {
  it('classifies diagnostics statuses for operational scanning', () => {
    expect(diagnosticStatusTone('ok')).toBe('ok')
    expect(diagnosticStatusTone('missing')).toBe('warn')
    expect(diagnosticStatusTone('corrupt')).toBe('error')
    expect(diagnosticStatusTone('invalid')).toBe('error')
    expect(diagnosticStatusTone('unknown')).toBe('muted')

    expect(diagnosticStatusText('ok')).toBe('正常')
    expect(diagnosticStatusText('missing')).toBe('缺失')
    expect(diagnosticStatusText('corrupt')).toBe('损坏')
  })

  it('projects config, runtime, and dependency diagnostics into stable rows', () => {
    const payload: DiagnosticsPayload = {
      root: '/repo',
      modelConfig: {
        path: '/repo/model_config.json',
        exists: false,
        status: 'missing',
        error: '',
      },
      localConfig: {
        path: '/repo/emperor.local.json',
        exists: true,
        status: 'corrupt',
        error: 'Unexpected token',
        corruptBackups: [{ path: '/repo/emperor.local.json.corrupt-1', bytes: 16 }],
      },
      scheduler: {
        lastActionErrors: [{ line: 2 }],
        corruptActionFiles: [{ path: '/repo/memory/scheduler/action.corrupt-1.jsonl', bytes: 9 }],
      },
      runtime: {
        events: 4,
        archiveFiles: 2,
        needsRotation: false,
      },
      workspacePolicy: {
        workspaceRoot: '/repo/project',
        stateRoot: '/repo/.emperor',
        allowRoots: [{ path: '/repo/project', label: 'workspace' }],
        denyRoots: [{ path: '/repo/.emperor', label: 'state' }],
        outsideWorkspace: 'deny',
      },
      external: {
        running: true,
        inbox: { pending: 3 },
        store: { exists: true, corruptBackups: [] },
      },
      activeTasks: [{ id: 'task_1' }],
      desktopPet: {
        enabled: false,
        autoStartWithWebui: false,
        running: false,
        installCommand: 'npm install',
      },
      dependencies: {
        nodeRuntime: true,
        desktopRenderer: true,
        desktopPetNodeModules: false,
      },
    }

    const groups = diagnosticRows(payload)
    const rows = groups.flatMap((group) => group.rows)

    expect(groups.map((group) => group.title)).toEqual(['配置', '运行时', '外部能力', '依赖'])
    expect(rows.find((row) => row.id === 'model-config')).toMatchObject({
      label: '模型配置',
      value: '缺失',
      tone: 'warn',
    })
    expect(rows.find((row) => row.id === 'local-config')).toMatchObject({
      label: '本地配置',
      value: '损坏',
      tone: 'error',
      detail: 'Unexpected token · 1 个腐化备份',
    })
    expect(rows.find((row) => row.id === 'scheduler-store')).toMatchObject({
      label: 'Scheduler Store',
      value: '异常',
      tone: 'error',
      detail: '1 个坏 action 行 · 1 个隔离文件',
    })
    expect(rows.find((row) => row.id === 'workspace-policy')).toMatchObject({
      label: 'Workspace Fence',
      value: '1 个允许根 / 1 个禁止根',
      tone: 'ok',
      detail: 'workspace /repo/project · state /repo/.emperor · outside deny',
    })
    expect(rows.find((row) => row.id === 'desktop-renderer')).toMatchObject({
      label: '桌面 Renderer',
      value: '已构建',
      tone: 'ok',
    })
    expect(rows.find((row) => row.id === 'node-runtime')).toMatchObject({
      label: 'Node.js Runtime',
      value: '可用',
      tone: 'ok',
    })
    expect(rows.find((row) => row.id === 'desktop-pet-modules')).toMatchObject({
      label: '桌宠依赖',
      value: '未安装',
      tone: 'warn',
    })
  })
})
