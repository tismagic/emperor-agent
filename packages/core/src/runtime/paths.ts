import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface RuntimePaths {
  runtimeRoot: string
  stateRoot: string
  templatesDir: string
  skillsDir: string
  assetsDir: string
  memoryRoot: string
  sessionsRoot: string
  projectsRoot: string
  attachmentsRoot: string
  mediaRoot: string
  tokensFile: string
  schedulerRoot: string
  teamRoot: string
  tasksRoot: string
  controlRoot: string
  externalRoot: string
}

export interface RuntimePathOptions {
  stateRoot?: string | null
  templatesDir?: string | null
}

export function resolveRuntimePaths(root: string, opts: RuntimePathOptions = {}): RuntimePaths {
  const runtimeRoot = resolve(root)
  const stateRoot = resolve(opts.stateRoot || join(runtimeRoot, '.emperor'))
  const templatesDir = resolve(opts.templatesDir || join(runtimeRoot, 'templates'))
  return {
    runtimeRoot,
    stateRoot,
    templatesDir,
    skillsDir: join(runtimeRoot, 'skills'),
    assetsDir: join(runtimeRoot, 'assets'),
    memoryRoot: join(stateRoot, 'memory'),
    sessionsRoot: join(stateRoot, 'sessions'),
    projectsRoot: join(stateRoot, 'projects'),
    attachmentsRoot: join(stateRoot, 'attachments'),
    mediaRoot: join(stateRoot, 'media'),
    tokensFile: join(stateRoot, 'tokens', 'tokens.jsonl'),
    schedulerRoot: join(stateRoot, 'scheduler'),
    teamRoot: join(stateRoot, 'team'),
    tasksRoot: join(stateRoot, 'tasks'),
    controlRoot: join(stateRoot, 'control'),
    externalRoot: join(stateRoot, 'external'),
  }
}

export function ensureRuntimeStateDirs(paths: RuntimePaths): void {
  for (const dir of [
    paths.stateRoot,
    paths.memoryRoot,
    paths.sessionsRoot,
    paths.projectsRoot,
    paths.attachmentsRoot,
    paths.mediaRoot,
    paths.schedulerRoot,
    paths.teamRoot,
    paths.tasksRoot,
    paths.controlRoot,
    paths.externalRoot,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  mkdirSync(join(paths.stateRoot, 'tokens'), { recursive: true })
}
