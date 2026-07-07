import { spawn } from 'node:child_process'
import type { HookCommandHandler, HookDecision, HookDefinition, HookExecutionResult, HookHttpHandler, HookInput } from './models'

const MAX_OUTPUT_CHARS = 64_000

export async function executeHook(hook: HookDefinition, input: HookInput): Promise<HookExecutionResult> {
  const started = Date.now()
  if (hook.handler.async) {
    void executeHookSync(hook, input).catch(() => {})
    return {
      hookId: hook.id,
      status: 'skipped',
      decision: 'passthrough',
      reason: 'async hook accepted',
      durationMs: Date.now() - started,
    }
  }
  return executeHookSync(hook, input)
}

async function executeHookSync(hook: HookDefinition, input: HookInput): Promise<HookExecutionResult> {
  const started = Date.now()
  if (hook.handler.type === 'command') {
    return executeCommandHook(hook.id, hook.handler, input, started)
  }
  return executeHttpHook(hook.id, hook.handler, input, started)
}

async function executeCommandHook(hookId: string, handler: HookCommandHandler, input: HookInput, started: number): Promise<HookExecutionResult> {
  return new Promise<HookExecutionResult>((resolve) => {
    const child = spawn(handler.command, handler.args, {
      cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
      env: allowedEnv(handler.allowedEnv),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({
        hookId,
        status: 'timeout',
        decision: 'passthrough',
        reason: `Hook timed out after ${handler.timeoutMs}ms`,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      })
    }, handler.timeoutMs)

    child.stdout?.on('data', (chunk) => { stdout = capOutput(stdout + String(chunk)) })
    child.stderr?.on('data', (chunk) => { stderr = capOutput(stderr + String(chunk)) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        hookId,
        status: 'failed',
        decision: 'passthrough',
        reason: error.message,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(resultFromProcessExit(hookId, code ?? 0, stdout, stderr, Date.now() - started))
    })
    child.stdin?.end(`${JSON.stringify(input)}\n`)
  })
}

async function executeHttpHook(hookId: string, handler: HookHttpHandler, input: HookInput, started: number): Promise<HookExecutionResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), handler.timeoutMs)
  try {
    const response = await fetch(handler.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...handler.headers },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    const text = capOutput(await response.text())
    if (!response.ok) {
      return {
        hookId,
        status: 'failed',
        decision: 'passthrough',
        reason: `HTTP ${response.status}`,
        durationMs: Date.now() - started,
        stdout: text,
      }
    }
    return resultFromJson(hookId, text, Date.now() - started, { status: 'completed', fallbackReason: response.statusText || 'ok' })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      hookId,
      status: aborted ? 'timeout' : 'failed',
      decision: 'passthrough',
      reason: aborted ? `Hook timed out after ${handler.timeoutMs}ms` : error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

function resultFromProcessExit(hookId: string, code: number, stdout: string, stderr: string, durationMs: number): HookExecutionResult {
  if (code === 2) {
    return {
      hookId,
      status: 'failed',
      decision: 'deny',
      reason: stderr.trim() || 'Hook denied',
      durationMs,
      stdout,
      stderr,
    }
  }
  if (code !== 0) {
    return {
      hookId,
      status: 'failed',
      decision: 'passthrough',
      reason: stderr.trim() || `Hook exited with code ${code}`,
      durationMs,
      stdout,
      stderr,
    }
  }
  return resultFromJson(hookId, stdout, durationMs, { status: 'completed', fallbackReason: 'ok', stderr })
}

function resultFromJson(
  hookId: string,
  raw: string,
  durationMs: number,
  opts: { status: HookExecutionResult['status']; fallbackReason: string; stderr?: string },
): HookExecutionResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { hookId, status: opts.status, decision: 'passthrough', reason: opts.fallbackReason, durationMs, stdout: raw, stderr: opts.stderr }
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const decision = parseDecision(parsed.decision)
    const result: HookExecutionResult = {
      hookId,
      status: opts.status,
      decision,
      reason: typeof parsed.reason === 'string' ? parsed.reason : opts.fallbackReason,
      durationMs,
      stdout: raw,
      stderr: opts.stderr,
    }
    if (typeof parsed.additionalContext === 'string') result.additionalContext = parsed.additionalContext
    if (isRecord(parsed.updatedInput)) result.updatedInput = parsed.updatedInput
    return result
  } catch {
    return { hookId, status: opts.status, decision: 'passthrough', reason: opts.fallbackReason, durationMs, stdout: raw, stderr: opts.stderr }
  }
}

function parseDecision(value: unknown): HookDecision {
  return value === 'deny' || value === 'ask' || value === 'allow' || value === 'passthrough' ? value : 'passthrough'
}

function allowedEnv(names: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function capOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) : value
}
