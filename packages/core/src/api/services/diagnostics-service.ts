import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { localConfigDiagnostics, type LocalConfigDiagnostics } from '../../config/local-config'
import { loadModelConfig, validateCompleteModelEntries } from '../../config/model-config'
import { listRecentPromptSnapshots } from '../../prompts/manifest'
import type { RuntimePaths } from '../../runtime/paths'

type Dict = Record<string, unknown>

export interface CoreDiagnosticsServiceDeps {
  runtimePaths?: RuntimePaths | null
  schedulerDiagnostics?: () => Dict
  runtimeStats?: () => Dict
  workspacePolicy?: () => Dict
  externalPayload?: () => Dict
  activeTasks?: () => unknown[]
  desktopPetPayload?: () => Dict | Promise<Dict>
}

export interface CoreDiagnosticsPayload {
  root: string
  paths: Dict
  modelConfig: Dict
  localConfig: LocalConfigDiagnostics
  scheduler: Dict
  runtime: Dict
  workspacePolicy: Dict
  promptSnapshots: Dict
  external: Dict
  activeTasks: unknown[]
  desktopPet: Dict
  dependencies: Dict
}

export class CoreDiagnosticsService {
  readonly root: string
  private readonly deps: CoreDiagnosticsServiceDeps

  constructor(root: string, deps: CoreDiagnosticsServiceDeps = {}) {
    this.root = resolve(root)
    this.deps = deps
  }

  async payload(): Promise<CoreDiagnosticsPayload> {
    return {
      root: this.root,
      paths: this.pathsPayload(),
      modelConfig: await this.modelConfig(),
      localConfig: await localConfigDiagnostics(this.root),
      scheduler: this.deps.schedulerDiagnostics?.() ?? {},
      runtime: this.deps.runtimeStats?.() ?? {},
      workspacePolicy: this.deps.workspacePolicy?.() ?? {},
      promptSnapshots: this.promptSnapshotsPayload(),
      external: this.deps.externalPayload?.() ?? {},
      activeTasks: this.deps.activeTasks?.() ?? [],
      desktopPet: await this.deps.desktopPetPayload?.() ?? {},
      dependencies: this.dependencies(),
    }
  }

  async modelConfig(): Promise<Dict> {
    const path = join(this.root, 'model_config.json')
    const exists = existsSync(path)
    const payload: Dict = {
      path,
      exists,
      status: exists ? 'unknown' : 'missing',
      error: '',
    }
    if (!exists) return payload
    try {
      const config = await loadModelConfig(this.root, { create: false })
      validateCompleteModelEntries(config.raw)
      payload.status = 'ok'
      payload.models = config.models.length
    } catch (err) {
      payload.status = 'invalid'
      payload.error = err instanceof Error ? err.message : String(err)
    }
    return payload
  }

  dependencies(): Dict {
    return {
      nodeRuntime: typeof process.versions.node === 'string' && process.versions.node.length > 0,
      desktopRenderer: existsSync(join(this.root, 'desktop', 'out', 'renderer', 'index.html')),
      desktopPetNodeModules: existsSync(join(this.root, 'desktop-pet', 'node_modules')),
    }
  }

  private pathsPayload(): Dict {
    const paths = this.deps.runtimePaths
    if (!paths) return { runtimeRoot: this.root, stateRoot: this.root }
    return { ...paths }
  }

  private promptSnapshotsPayload(): Dict {
    const paths = this.deps.runtimePaths
    if (!paths) return { count: 0, recent: [] }
    return listRecentPromptSnapshots(paths.sessionsRoot, 5)
  }
}
