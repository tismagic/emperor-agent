import { apiUrl, hasCoreBridge } from './backend'

export function mediaRawUrl(id: string): string {
  if (hasCoreBridge()) return `app://media/${encodeURIComponent(id)}/raw`
  return apiUrl(`/api/media/${encodeURIComponent(id)}/raw`)
}
