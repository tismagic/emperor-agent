import { ref, computed } from 'vue'
import { api } from '../api/http'
import type { ProjectInfo, SessionInfo, SessionMode, WsEvent } from '../types'
import {
  applySessionCreated,
  applySessionTitleUpdated,
  createDraftSession,
  isDraftSessionId,
} from '../runtime/sessionDrafts'

const sessions = ref<SessionInfo[]>([])
const activeId = ref<string>('')
const loading = ref(false)

export interface CreateSessionDraftOptions {
  title?: string
  mode?: SessionMode
  project?: ProjectInfo
}

export function useSession() {
  const active = computed(() => sessions.value.find((s) => s.id === activeId.value))

  async function load() {
    loading.value = true
    try {
      sessions.value = await api<SessionInfo[]>('/api/sessions')
      if (!sessions.value.length) {
        const draft = createDraftSession()
        sessions.value = [draft]
        activeId.value = draft.id
      } else if (!activeId.value || !sessions.value.some((session) => session.id === activeId.value)) {
        activeId.value = sessions.value[0].id
      }
    } finally {
      loading.value = false
    }
  }

  async function loadArchived(): Promise<SessionInfo[]> {
    return api<SessionInfo[]>('/api/sessions?archived=1')
  }

  function create(options: string | CreateSessionDraftOptions = '新会话'): SessionInfo {
    const opts = typeof options === 'string' ? { title: options } : options
    const mode: SessionMode = opts.mode === 'build' ? 'build' : 'chat'
    const existingDraft = sessions.value.find((session) =>
      session.draft
      && session.mode === mode
      && (mode === 'chat' || session.project_id === opts.project?.project_id),
    )
    if (existingDraft) {
      activeId.value = existingDraft.id
      return existingDraft
    }
    const draft = createDraftSession({
      title: (opts.title || '').trim() || '新会话',
      mode,
      projectId: opts.project?.project_id,
      projectPath: opts.project?.project_path,
      projectName: opts.project?.project_name,
    })
    sessions.value.unshift(draft)
    activeId.value = draft.id
    return draft
  }

  async function resolveProject(path: string): Promise<ProjectInfo> {
    return api<ProjectInfo>('/api/projects/resolve', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async function remove(id: string): Promise<boolean> {
    if (isDraftSessionId(id)) {
      sessions.value = sessions.value.filter((s) => s.id !== id)
      if (activeId.value === id) activeId.value = sessions.value[0]?.id || ''
      if (!sessions.value.length) create()
      return true
    }
    try {
      await api<{ deleted: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      sessions.value = sessions.value.filter((s) => s.id !== id)
      if (activeId.value === id) activeId.value = sessions.value[0]?.id || ''
      if (!sessions.value.length) create()
      return true
    } catch {
      return false
    }
  }

  async function rename(id: string, title: string): Promise<boolean> {
    if (isDraftSessionId(id)) {
      const hit = sessions.value.find((s) => s.id === id)
      if (hit) hit.title = title
      return true
    }
    try {
      await api<SessionInfo>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      const hit = sessions.value.find((s) => s.id === id)
      if (hit) hit.title = title
      return true
    } catch {
      return false
    }
  }

  async function archive(id: string, archived: boolean): Promise<boolean> {
    if (isDraftSessionId(id)) {
      if (archived) {
        sessions.value = sessions.value.filter((s) => s.id !== id)
        if (activeId.value === id) activeId.value = sessions.value[0]?.id || ''
      }
      return true
    }
    try {
      const updated = await api<SessionInfo>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
      })
      if (archived) {
        sessions.value = sessions.value.filter((s) => s.id !== id)
        if (activeId.value === id) activeId.value = sessions.value[0]?.id || ''
        if (!sessions.value.length) create()
      } else {
        const index = sessions.value.findIndex((s) => s.id === id)
        if (index >= 0) sessions.value[index] = updated
        else sessions.value.unshift(updated)
      }
      return true
    } catch {
      return false
    }
  }

  async function activate(id: string): Promise<void> {
    activeId.value = id
    if (!isDraftSessionId(id)) {
      await api<{ active: string; complete: boolean }>(`/api/sessions/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => undefined)
    }
  }

  function applySessionCreatedEvent(event: Extract<WsEvent, { event: 'session_created' }>) {
    sessions.value = applySessionCreated(sessions.value, event)
    if (event.client_draft_id && activeId.value === event.client_draft_id && event.session?.id) {
      activeId.value = event.session.id
    }
  }

  function applySessionTitleUpdatedEvent(event: Extract<WsEvent, { event: 'session_title_updated' }>) {
    sessions.value = applySessionTitleUpdated(sessions.value, event)
  }

  function backendSessionId() {
    return isDraftSessionId(activeId.value) ? '' : activeId.value
  }

  function getSession(id: string) {
    return sessions.value.find((session) => session.id === id)
  }

  return {
    sessions,
    activeId,
    active,
    loading,
    load,
    loadArchived,
    create,
    resolveProject,
    remove,
    rename,
    archive,
    activate,
    applySessionCreatedEvent,
    applySessionTitleUpdatedEvent,
    backendSessionId,
    getSession,
    isDraftSessionId,
  }
}
