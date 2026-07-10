import type {
  ModelConfigPayload,
  ModelDiscoveryResult,
  ModelTestResult,
} from '../types'
import { invokeCore } from './backend'

export async function saveOnboardingModelConfig(
  settings: Record<string, unknown>,
): Promise<ModelConfigPayload> {
  return invokeCore(
    'model.saveOnboardingConfig',
    settings,
  ) as Promise<ModelConfigPayload>
}

export async function testModelEntry(
  entryName: string,
  kind: 'text' | 'vision',
  role: 'main' | 'secondary' = 'main',
): Promise<ModelTestResult> {
  return invokeCore('model.test', {
    entryName,
    kind,
    role,
  }) as Promise<ModelTestResult>
}

export async function discoverProviderModels(
  settings: Record<string, unknown>,
): Promise<ModelDiscoveryResult> {
  return invokeCore(
    'model.discoverModels',
    settings,
  ) as Promise<ModelDiscoveryResult>
}
