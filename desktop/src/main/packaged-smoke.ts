import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  GlobTool,
  GrepTool,
  writeJsonAtomic,
  type CoreApi,
} from '@emperor/core'

export interface PackagedSmokeCore {
  bootstrap(): Promise<unknown>
  diagnostics: { get(): Promise<unknown> }
  environment: {
    getStatus(input: {
      forceRefresh: boolean
      projectRoot: string
    }): Promise<unknown>
  }
}

export interface PackagedSmokeOptions {
  core: PackagedSmokeCore
  runtimeRoot: string
  stateRoot: string
  receiptPath: string
  appVersion: string
  runtimeRevision: string
  commit: string
  platform: NodeJS.Platform | string
  arch: string
  now?: () => string
}

export interface PackagedSmokeReceipt {
  schemaVersion: 1
  appVersion: string
  commit: string
  platform: string
  arch: string
  runtimeRevision: string
  runtimeManifestHash: string
  stateRoot: '$TEMP/stateRoot'
  startedAt: string
  finishedAt: string
  operations: {
    bootstrap: { ok: boolean; builtInSkills: string[] }
    diagnostics: { ok: boolean }
    environment: { ok: boolean; tools: number; blockedSkills: number }
    glob: { ok: boolean; matches: number }
    grep: { ok: boolean; matches: number }
  }
  installJobs: { before: number; after: number }
  exitCode: 0 | 1
  error?: { code: 'smoke_failed'; message: string }
}

type SmokeStatus = {
  status?: {
    tools?: unknown[]
    skills?: Array<{ status?: unknown }>
  }
  activeJob?: unknown
  recentJobs?: unknown[]
}

export function parsePackagedSmokeArgs(
  argv: readonly string[],
): { receiptPath: string } | null {
  if (!argv.includes('--emperor-packaged-smoke')) return null
  const index = argv.indexOf('--emperor-smoke-receipt')
  const receiptPath = index >= 0 ? String(argv[index + 1] || '').trim() : ''
  if (!receiptPath || !isAbsolute(receiptPath))
    throw new Error('packaged smoke receipt path must be absolute')
  return { receiptPath: resolve(receiptPath) }
}

export async function runPackagedSmoke(
  opts: PackagedSmokeOptions,
): Promise<PackagedSmokeReceipt> {
  const startedAt = (opts.now ?? (() => new Date().toISOString()))()
  const runtimeRoot = resolve(opts.runtimeRoot)
  const stateRoot = resolve(opts.stateRoot)
  const receiptPath = resolve(opts.receiptPath)
  assertWritableSmokePaths(runtimeRoot, stateRoot, receiptPath)
  const workspaceRoot = join(stateRoot, 'packaged-smoke-workspace')
  const base = await receiptBase(opts, startedAt)

  try {
    await createSmokeWorkspace(workspaceRoot)
    const bootstrap = asRecord(await opts.core.bootstrap())
    const builtInSkills = skillNames(bootstrap.skills)
    if (builtInSkills.length !== 1 || builtInSkills[0] !== 'skill-creator')
      throw new Error('packaged smoke requires only built-in skill-creator')

    await opts.core.diagnostics.get()
    const environmentBefore = asSmokeStatus(
      await opts.core.environment.getStatus({
        forceRefresh: true,
        projectRoot: workspaceRoot,
      }),
    )
    const jobsBefore = installJobCount(environmentBefore)
    if (jobsBefore !== 0)
      throw new Error('packaged smoke state must not contain install jobs')

    const context = {
      root: workspaceRoot,
      workspaceRoot,
      arguments: {},
    }
    const globOutput = String(
      await new GlobTool(workspaceRoot).execute(
        { pattern: '**/*.ts' },
        { ...context, arguments: { pattern: '**/*.ts' } },
      ),
    )
    const grepOutput = String(
      await new GrepTool(workspaceRoot).execute(
        { pattern: 'emperorSmokeNeedle', output_mode: 'files_with_matches' },
        {
          ...context,
          arguments: {
            pattern: 'emperorSmokeNeedle',
            output_mode: 'files_with_matches',
          },
        },
      ),
    )
    assertSearchResult(globOutput, 'src/smoke.ts', 'glob')
    assertSearchResult(grepOutput, 'src/smoke.ts', 'grep')

    const environmentAfter = asSmokeStatus(
      await opts.core.environment.getStatus({
        forceRefresh: true,
        projectRoot: workspaceRoot,
      }),
    )
    const jobsAfter = installJobCount(environmentAfter)
    if (jobsAfter !== jobsBefore)
      throw new Error('packaged smoke must not create environment install jobs')

    const receipt: PackagedSmokeReceipt = {
      ...base,
      finishedAt: (opts.now ?? (() => new Date().toISOString()))(),
      operations: {
        bootstrap: { ok: true, builtInSkills },
        diagnostics: { ok: true },
        environment: {
          ok: true,
          tools: environmentBefore.status?.tools?.length ?? 0,
          blockedSkills:
            environmentBefore.status?.skills?.filter(
              (skill) => skill.status === 'blocked',
            ).length ?? 0,
        },
        glob: { ok: true, matches: lineCount(globOutput) },
        grep: { ok: true, matches: lineCount(grepOutput) },
      },
      installJobs: { before: jobsBefore, after: jobsAfter },
      exitCode: 0,
    }
    await writeJsonAtomic(receiptPath, receipt)
    return receipt
  } catch (error) {
    const receipt: PackagedSmokeReceipt = {
      ...base,
      finishedAt: (opts.now ?? (() => new Date().toISOString()))(),
      operations: {
        bootstrap: { ok: false, builtInSkills: [] },
        diagnostics: { ok: false },
        environment: { ok: false, tools: 0, blockedSkills: 0 },
        glob: { ok: false, matches: 0 },
        grep: { ok: false, matches: 0 },
      },
      installJobs: { before: 0, after: 0 },
      exitCode: 1,
      error: {
        code: 'smoke_failed',
        message: 'Packaged smoke verification failed.',
      },
    }
    await writeJsonAtomic(receiptPath, receipt).catch(() => {})
    throw error
  }
}

export type PackagedSmokeCoreApi = Pick<
  CoreApi,
  'bootstrap' | 'diagnostics' | 'environment'
>

async function receiptBase(
  opts: PackagedSmokeOptions,
  startedAt: string,
): Promise<
  Omit<
    PackagedSmokeReceipt,
    'finishedAt' | 'operations' | 'installJobs' | 'exitCode' | 'error'
  >
> {
  const manifest = await readFile(
    join(opts.runtimeRoot, 'runtime-manifest.json'),
  )
  return {
    schemaVersion: 1,
    appVersion: bounded(opts.appVersion, 64, 'app version'),
    commit: normalizeCommit(opts.commit),
    platform: bounded(opts.platform, 24, 'platform'),
    arch: bounded(opts.arch, 24, 'architecture'),
    runtimeRevision: digest(opts.runtimeRevision, 'runtime revision'),
    runtimeManifestHash: createHash('sha256').update(manifest).digest('hex'),
    stateRoot: '$TEMP/stateRoot',
    startedAt,
  }
}

async function createSmokeWorkspace(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'smoke.ts'),
    "export const emperorSmokeNeedle = 'ready'\n",
    'utf8',
  )
  await writeFile(join(root, 'README.md'), '# Packaged smoke\n', 'utf8')
}

function assertWritableSmokePaths(
  runtimeRoot: string,
  stateRoot: string,
  receiptPath: string,
): void {
  if (
    !isAbsolute(runtimeRoot) ||
    !isAbsolute(stateRoot) ||
    !isAbsolute(receiptPath)
  )
    throw new Error('packaged smoke paths must be absolute')
  if (
    containsPath(runtimeRoot, stateRoot) ||
    containsPath(stateRoot, runtimeRoot)
  )
    throw new Error('packaged smoke runtime and state roots must be separate')
  if (containsPath(runtimeRoot, receiptPath))
    throw new Error('packaged smoke receipt must not modify signed resources')
}

function containsPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function skillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asRecord(item).name)
    .filter((name): name is string => typeof name === 'string')
    .sort()
}

function asSmokeStatus(value: unknown): SmokeStatus {
  return asRecord(value) as SmokeStatus
}

function installJobCount(value: SmokeStatus): number {
  return (value.recentJobs?.length ?? 0) + (value.activeJob ? 1 : 0)
}

function assertSearchResult(output: string, expected: string, tool: string) {
  if (output.startsWith('[ERR]') || !output.split(/\r?\n/).includes(expected))
    throw new Error(`packaged ${tool} smoke failed`)
}

function lineCount(value: string): number {
  if (!value || value === '(no matches)') return 0
  return value.split(/\r?\n/).filter(Boolean).length
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function bounded(value: unknown, max: number, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > max)
    throw new Error(`invalid packaged smoke ${label}`)
  return normalized
}

function digest(value: unknown, label: string): string {
  const normalized = bounded(value, 64, label)
  if (!/^[a-f0-9]{64}$/i.test(normalized))
    throw new Error(`invalid packaged smoke ${label}`)
  return normalized.toLowerCase()
}

function normalizeCommit(value: unknown): string {
  const normalized = String(value ?? '').trim()
  if (normalized === 'local') return normalized
  if (!/^[a-f0-9]{7,64}$/i.test(normalized))
    throw new Error('invalid packaged smoke commit')
  return normalized.toLowerCase()
}
