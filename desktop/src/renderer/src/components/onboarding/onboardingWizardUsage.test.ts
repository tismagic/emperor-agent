import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(__dirname, '..', '..')

describe('OnboardingWizard model configuration UI', () => {
  it('keeps model discovery in the primary flow and moves advanced fields behind details', () => {
    const source = readFileSync(join(rendererRoot, 'components/onboarding/OnboardingWizard.vue'), 'utf8')

    expect(source).toContain('discoverProviderModels')
    expect(source).toContain('获取模型')
    expect(source).toContain('class="onboarding-advanced span-2"')
    expect(source).toContain('modelCandidates')
  })
})
