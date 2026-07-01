import type { ModelConfigPayload, ModelTestResult } from '../types'
import { apiUrl, hasCoreBridge, invokeCore } from './backend'

export async function saveOnboardingModelConfig(settings: Record<string, unknown>): Promise<ModelConfigPayload> {
  if (!hasCoreBridge()) throw new Error('Core IPC bridge is required for first-run onboarding')
  return invokeCore('model.saveOnboardingConfig', settings) as Promise<ModelConfigPayload>
}

export async function testModelEntry(
  entryName: string,
  kind: 'text' | 'vision',
  role: 'main' | 'secondary' = 'main',
): Promise<ModelTestResult> {
  if (hasCoreBridge()) return invokeCore('model.test', { entryName, kind, role }) as Promise<ModelTestResult>
  const r = await fetch(apiUrl('/api/model-test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryName, kind, role }),
  })
  // 后端在测试失败时仍返回 200 + ok:false；非 2xx 才走 throw
  if (!r.ok && r.status >= 500) {
    let message = `HTTP ${r.status}`
    try {
      const data = await r.json()
      if (data && typeof data.error === 'string') message = data.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return (await r.json()) as ModelTestResult
}
