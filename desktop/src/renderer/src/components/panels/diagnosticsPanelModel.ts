import type {
  DesktopPetPayload,
  DiagnosticsConfigSummary,
  DiagnosticsDependencyPayload,
  DiagnosticsPayload,
  ExternalDiagnosticsPayload,
  RuntimeStats,
  SchedulerDiagnosticsPayload,
  WorkspacePolicyDiagnosticsPayload,
} from '../../types'

export type DiagnosticTone = 'ok' | 'warn' | 'error' | 'muted'

export interface DiagnosticRow {
  id: string
  label: string
  value: string
  detail: string
  tone: DiagnosticTone
  path?: string
}

export interface DiagnosticGroup {
  id: string
  title: string
  rows: DiagnosticRow[]
}

export function diagnosticStatusTone(status: unknown): DiagnosticTone {
  const normalized = String(status || 'unknown').toLowerCase()
  if (['ok', 'ready', 'running', 'healthy'].includes(normalized)) return 'ok'
  if (['corrupt', 'invalid', 'error', 'failed', 'failure'].includes(normalized)) return 'error'
  if (['missing', 'disabled', 'stopped', 'not_installed', 'not-installed', 'warning', 'warn'].includes(normalized)) return 'warn'
  return 'muted'
}

export function diagnosticStatusText(status: unknown): string {
  const normalized = String(status || 'unknown').toLowerCase()
  const labels: Record<string, string> = {
    ok: '正常',
    ready: '就绪',
    running: '运行中',
    healthy: '正常',
    missing: '缺失',
    corrupt: '损坏',
    invalid: '无效',
    error: '异常',
    failed: '失败',
    failure: '失败',
    disabled: '已关闭',
    stopped: '已停止',
    unknown: '未知',
    warning: '警告',
    warn: '警告',
    not_installed: '未安装',
    'not-installed': '未安装',
  }
  return labels[normalized] || String(status || '未知')
}

export function diagnosticRows(payload: DiagnosticsPayload | null | undefined): DiagnosticGroup[] {
  const diagnostics = payload || {}
  return [
    {
      id: 'config',
      title: '配置',
      rows: [
        configRow('model-config', '模型配置', diagnostics.modelConfig),
        configRow('local-config', '本地配置', diagnostics.localConfig),
      ],
    },
    {
      id: 'runtime',
      title: '运行时',
      rows: [
        schedulerRow(diagnostics.scheduler),
        runtimeRow(diagnostics.runtime),
        workspacePolicyRow(diagnostics.workspacePolicy),
        activeTasksRow(diagnostics.activeTasks),
      ],
    },
    {
      id: 'external',
      title: '外部能力',
      rows: [
        externalRow(diagnostics.external),
        desktopPetRow(diagnostics.desktopPet),
      ],
    },
    {
      id: 'dependencies',
      title: '依赖',
      rows: dependencyRows(diagnostics.dependencies),
    },
  ]
}

function configRow(id: string, label: string, summary: DiagnosticsConfigSummary | undefined): DiagnosticRow {
  const status = summary?.status || 'unknown'
  const backupCount = count(summary?.corruptBackups)
  return {
    id,
    label,
    value: diagnosticStatusText(status),
    detail: joinParts([
      summary?.error,
      typeof summary?.models === 'number' ? `${summary.models} 个模型条目` : '',
      backupCount ? `${backupCount} 个腐化备份` : '',
    ]),
    tone: diagnosticStatusTone(status),
    path: summary?.path,
  }
}

function schedulerRow(summary: SchedulerDiagnosticsPayload | undefined): DiagnosticRow {
  const errorCount = count(summary?.lastActionErrors)
  const corruptCount = count(summary?.corruptActionFiles)
  const hasError = errorCount > 0 || corruptCount > 0
  return {
    id: 'scheduler-store',
    label: 'Scheduler Store',
    value: hasError ? '异常' : summary ? '正常' : '未返回',
    detail: joinParts([
      errorCount ? `${errorCount} 个坏 action 行` : '',
      corruptCount ? `${corruptCount} 个隔离文件` : '',
      !hasError ? summary?.jobsFile : '',
    ]),
    tone: hasError ? 'error' : summary ? 'ok' : 'muted',
    path: summary?.jobsFile,
  }
}

function runtimeRow(runtime: RuntimeStats | undefined): DiagnosticRow {
  return {
    id: 'runtime-events',
    label: 'Runtime Events',
    value: runtime ? `${numberOrZero(runtime.events)} 条事件` : '未返回',
    detail: runtime
      ? joinParts([
        `${numberOrZero(runtime.archiveFiles)} 个归档`,
        runtime.needsRotation ? '需要轮转' : '无需轮转',
        runtime.path,
      ])
      : '未返回详细信息',
    tone: runtime?.needsRotation ? 'warn' : runtime ? 'ok' : 'muted',
    path: runtime?.path,
  }
}

function activeTasksRow(activeTasks: unknown[] | undefined): DiagnosticRow {
  const taskCount = count(activeTasks)
  return {
    id: 'active-tasks',
    label: 'Active Tasks',
    value: taskCount ? `${taskCount} 个运行中` : '空闲',
    detail: taskCount ? '有可取消任务' : '当前没有登记的运行任务',
    tone: taskCount ? 'warn' : 'ok',
  }
}

function workspacePolicyRow(policy: WorkspacePolicyDiagnosticsPayload | undefined): DiagnosticRow {
  const allowRoots = policy?.allowRoots ?? []
  const denyRoots = policy?.denyRoots ?? []
  const workspaceRoot = policy?.workspaceRoot || ''
  const stateRoot = policy?.stateRoot || ''
  return {
    id: 'workspace-policy',
    label: 'Workspace Fence',
    value: policy ? `${allowRoots.length} 个允许根 / ${denyRoots.length} 个禁止根` : '未返回',
    detail: policy
      ? joinParts([
        workspaceRoot ? `workspace ${workspaceRoot}` : '',
        stateRoot ? `state ${stateRoot}` : '',
        policy.outsideWorkspace ? `outside ${policy.outsideWorkspace}` : '',
      ])
      : '未返回详细信息',
    tone: !policy ? 'muted' : allowRoots.length ? 'ok' : 'warn',
    path: workspaceRoot || stateRoot || undefined,
  }
}

function externalRow(external: ExternalDiagnosticsPayload | undefined): DiagnosticRow {
  const pending = numberOrZero(external?.inbox?.pending)
  const errors = count(external?.recentErrors)
  const backups = count(external?.store?.corruptBackups)
  const tone: DiagnosticTone = errors || backups ? 'error' : external?.running ? 'ok' : external ? 'warn' : 'muted'
  return {
    id: 'external-bridge',
    label: 'External Bridge',
    value: external ? (external.running ? '运行中' : '已停止') : '未返回',
    detail: joinParts([
      `${pending} 条待处理`,
      errors ? `${errors} 个近期错误` : '',
      backups ? `${backups} 个腐化备份` : '',
      external?.store?.path || '',
    ]),
    tone,
    path: external?.store?.path || undefined,
  }
}

function desktopPetRow(pet: (DesktopPetPayload & Record<string, unknown>) | undefined): DiagnosticRow {
  const enabled = Boolean(pet?.enabled)
  const running = Boolean(pet?.running)
  const lastError = typeof pet?.lastError === 'string' ? pet.lastError : ''
  return {
    id: 'desktop-pet',
    label: '桌宠',
    value: running ? '运行中' : enabled ? '待启动' : '已关闭',
    detail: joinParts([
      lastError,
      pet?.pid ? `PID ${pet.pid}` : '',
      pet?.autoStartWithWebui ? '跟随 WebUI' : '手动',
    ]),
    tone: lastError ? 'error' : running ? 'ok' : enabled ? 'warn' : 'muted',
  }
}

function dependencyRows(dependencies: DiagnosticsDependencyPayload | undefined): DiagnosticRow[] {
  return [
    dependencyRow('node-runtime', 'Node.js Runtime', dependencies?.nodeRuntime, '可用', '不可用'),
    dependencyRow('desktop-renderer', '桌面 Renderer', dependencies?.desktopRenderer, '已构建', '缺少构建产物'),
    dependencyRow('desktop-pet-modules', '桌宠依赖', dependencies?.desktopPetNodeModules, '已安装', '未安装'),
  ]
}

function dependencyRow(id: string, label: string, present: unknown, okValue: string, missingValue: string): DiagnosticRow {
  if (typeof present !== 'boolean') {
    return {
      id,
      label,
      value: '未返回',
      detail: '依赖检查未返回该字段',
      tone: 'muted',
    }
  }
  return {
    id,
    label,
    value: present ? okValue : missingValue,
    detail: present ? '依赖可用' : '需要按需安装或重新构建',
    tone: present ? 'ok' : 'warn',
  }
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '未返回详细信息'
}
