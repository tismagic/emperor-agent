import type { DiscoveredModel, ModelEntry } from '../../../types'

export interface ModelPickerOption extends DiscoveredModel {
  custom?: boolean
}

export function normalizeModelOptions(
  options: DiscoveredModel[],
  currentValue = '',
): ModelPickerOption[] {
  const result: ModelPickerOption[] = []
  const seen = new Set<string>()
  const current = currentValue.trim()

  if (current && !options.some((option) => option.id.trim() === current)) {
    result.push({ id: current, custom: true })
    seen.add(current)
  }

  for (const option of options) {
    const id = option.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id === option.id ? option : { ...option, id })
  }

  return result
}

export function filterModelOptions(
  options: ModelPickerOption[],
  query: string,
): ModelPickerOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return options
  return options.filter(
    (option) =>
      !option.custom &&
      (option.id.toLocaleLowerCase().includes(normalizedQuery) ||
        String(option.ownedBy || '')
          .toLocaleLowerCase()
          .includes(normalizedQuery)),
  )
}

export function applyModelSelection(
  entry: ModelEntry,
  role: 'main' | 'secondary',
  value: string,
): ModelEntry {
  if (role === 'main') {
    return { ...entry, id: value, mainModelId: value }
  }
  return { ...entry, secondaryModelId: value }
}
