import { ref, computed } from 'vue'
import { api } from '../api/http'
import type { SessionInfo } from '../types'

export function useSession() {
  const sessions = ref<SessionInfo[]>([])
  const activeId = ref<string>('')
  const loading = ref(false)

  const active = computed(() => sessions.value.find((s) => s.id === activeId.value))

  async function load() {
    loading.value = true
    try {
      sessions.value = await api<SessionInfo[]>('/api/sessions')
    } finally {
      loading.value = false
    }
  }

  async function create(title: string): Promise<SessionInfo | null> {
    const s = await api<SessionInfo>('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (s && s.id) {
      sessions.value.unshift(s)
    }
    return s
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api<{ deleted: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      sessions.value = sessions.value.filter((s) => s.id !== id)
      return true
    } catch {
      return false
    }
  }

  async function rename(id: string, title: string): Promise<boolean> {
    try {
      await api<SessionInfo>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const hit = sessions.value.find((s) => s.id === id)
      if (hit) hit.title = title
      return true
    } catch {
      return false
    }
  }

  async function activate(id: string): Promise<void> {
    activeId.value = id
  }

  return { sessions, activeId, active, loading, load, create, remove, rename, activate }
}
