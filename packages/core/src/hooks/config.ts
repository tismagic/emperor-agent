import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readJson, writeJsonAtomic } from '../store/atomic-json'
import type { HookDefinition, HookDiagnostic, HookSource, HooksConfig } from './models'
import { defaultHooksConfig, parseHooksConfig } from './schema'

export const HOOKS_CONFIG_FILE = 'hooks_config.json'

export interface HookConfigSourceInfo extends HookSource {
  enabled: boolean
  diagnostics: HookDiagnostic[]
}
export interface HookConfigLoadResult {
  config: HooksConfig
  diagnostics: HookDiagnostic[]
  sources: HookConfigSourceInfo[]
}

export class HookConfigLoader {
  readonly stateRoot: string
  readonly globalConfigPath: string

  constructor(opts: { stateRoot: string }) {
    this.stateRoot = resolve(opts.stateRoot)
    this.globalConfigPath = join(this.stateRoot, HOOKS_CONFIG_FILE)
  }

  async load(opts: { projectRoot?: string | null } = {}): Promise<HookConfigLoadResult> {
    const diagnostics: HookDiagnostic[] = []
    const globalSource: HookSource = { kind: 'global', path: this.globalConfigPath, readonly: false }
    const globalRaw = await readJson<unknown>(this.globalConfigPath, null, {
      onCorrupt: (info) => diagnostics.push({
        code: 'corrupt_config',
        path: info.path,
        message: `Corrupt hooks config preserved at ${info.backupPath}`,
      }),
    })
    const globalParsed = parseHooksConfig(globalRaw, { source: globalSource })
    diagnostics.push(...globalParsed.diagnostics)
    const sources: HookConfigSourceInfo[] = [{
      ...globalSource,
      enabled: globalParsed.config.enabled,
      diagnostics: globalParsed.diagnostics,
    }]

    const config = cloneConfig(globalParsed.config)
    const seen = new Set<string>()
    recordSeenHooks(seen, this.stateRoot, config)

    const projectRoot = opts.projectRoot ? resolve(opts.projectRoot) : null
    if (projectRoot && config.projectHooks.enabled) {
      const projectFiles = [
        join(projectRoot, '.emperor', 'settings.json'),
        join(projectRoot, '.emperor', 'settings.local.json'),
      ]
      for (const path of projectFiles) {
        const loaded = await this.loadProjectFile(path)
        if (!loaded) continue
        sources.push(loaded.source)
        diagnostics.push(...loaded.source.diagnostics)
        if (!loaded.parsed.config.enabled) continue
        mergeHooks(config, loaded.parsed.config, seen, projectRoot)
      }
    }

    return { config, diagnostics, sources }
  }

  async saveGlobalConfig(input: unknown): Promise<HookConfigLoadResult> {
    const parsed = parseHooksConfig(input, { source: { kind: 'global', path: this.globalConfigPath, readonly: false } })
    if (parsed.diagnostics.length > 0) {
      return {
        config: parsed.config,
        diagnostics: parsed.diagnostics,
        sources: [{ kind: 'global', path: this.globalConfigPath, readonly: false, enabled: parsed.config.enabled, diagnostics: parsed.diagnostics }],
      }
    }
    await writeJsonAtomic(this.globalConfigPath, serializeConfig(parsed.config))
    return this.load()
  }

  private async loadProjectFile(path: string): Promise<{ parsed: ReturnType<typeof parseHooksConfig>; source: HookConfigSourceInfo } | null> {
    if (!existsSync(path)) return null
    const source: HookSource = { kind: 'project', path, readonly: true }
    let raw: unknown
    try {
      raw = JSON.parse((await readFile(path, 'utf8')) || '{}')
    } catch (error) {
      const diagnostics = [{
        code: 'corrupt_project_config',
        path,
        message: error instanceof Error ? error.message : String(error),
      }]
      return { parsed: { config: defaultHooksConfig(), diagnostics }, source: { ...source, enabled: false, diagnostics } }
    }
    const parsed = parseHooksConfig(raw, { source })
    return { parsed, source: { ...source, enabled: parsed.config.enabled, diagnostics: parsed.diagnostics } }
  }
}

function cloneConfig(config: HooksConfig): HooksConfig {
  const hooks: HooksConfig['hooks'] = {}
  for (const [eventName, entries] of Object.entries(config.hooks) as Array<[keyof HooksConfig['hooks'], HookDefinition[] | undefined]>) {
    if (entries?.length) hooks[eventName] = entries.map((entry) => ({ ...entry, handler: { ...entry.handler } }))
  }
  return {
    version: 1,
    enabled: config.enabled,
    projectHooks: { enabled: config.projectHooks.enabled },
    hooks,
  }
}

function mergeHooks(target: HooksConfig, incoming: HooksConfig, seen: Set<string>, sourceRoot: string): void {
  for (const [eventName, entries] of Object.entries(incoming.hooks) as Array<[keyof HooksConfig['hooks'], HookDefinition[] | undefined]>) {
    if (!entries?.length) continue
    const existing = target.hooks[eventName] ?? []
    for (const hook of entries) {
      const key = dedupeKey(sourceRoot, hook)
      if (seen.has(key)) continue
      seen.add(key)
      existing.push(hook)
    }
    if (existing.length > 0) target.hooks[eventName] = existing
  }
}

function recordSeenHooks(seen: Set<string>, sourceRoot: string, config: HooksConfig): void {
  for (const entries of Object.values(config.hooks)) {
    for (const hook of entries ?? []) seen.add(dedupeKey(sourceRootForHook(sourceRoot, hook), hook))
  }
}

function sourceRootForHook(fallback: string, hook: HookDefinition): string {
  return hook.source?.kind === 'global' ? dirname(hook.source.path) : fallback
}

function dedupeKey(sourceRoot: string, hook: HookDefinition): string {
  return JSON.stringify({
    sourceRoot: resolve(sourceRoot),
    eventName: hook.eventName,
    matcher: hook.matcher,
    condition: hook.condition,
    handler: hook.handler,
  })
}

function serializeConfig(config: HooksConfig): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {}
  for (const [eventName, entries] of Object.entries(config.hooks)) {
    hooks[eventName] = (entries ?? []).map((hook) => ({
      id: hook.id,
      enabled: hook.enabled,
      matcher: hook.matcher,
      if: hook.condition,
      handler: hook.handler,
    }))
  }
  return {
    version: config.version,
    enabled: config.enabled,
    projectHooks: { enabled: config.projectHooks.enabled },
    hooks,
  }
}
