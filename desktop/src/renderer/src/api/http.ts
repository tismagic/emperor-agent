import { apiUrl, getBackendToken } from './backend'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getBackendToken()
  const response = await fetch(apiUrl(path), {
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'X-Emperor-Auth-Token': token } : {}),
      ...(options.headers || {}),
    },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : response.statusText
    throw new Error(message)
  }
  return data as T
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
