import { describe, it, expect } from 'vitest'
import { THEMES, DEFAULT_THEME, isTheme, applyTheme } from './tokens'

function fakeDoc() {
  return { documentElement: { dataset: {} as Record<string, string> } }
}

describe('theme tokens', () => {
  it('defaults to dark and lists both themes', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(THEMES).toEqual(['dark', 'light'])
  })

  it('validates theme names', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('light')).toBe(true)
    expect(isTheme('paper')).toBe(false)
    expect(isTheme(undefined)).toBe(false)
  })

  it('applyTheme writes the theme to documentElement.dataset', () => {
    const doc = fakeDoc()
    const applied = applyTheme(doc as unknown as Document, 'light')
    expect(applied).toBe('light')
    expect(doc.documentElement.dataset.theme).toBe('light')
  })

  it('applyTheme falls back to the default for invalid names', () => {
    const doc = fakeDoc()
    const applied = applyTheme(doc as unknown as Document, 'paper' as never)
    expect(applied).toBe('dark')
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })
})
