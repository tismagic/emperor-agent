<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSession } from '../../composables/useSession'
import { Plus, Trash2, Check } from 'lucide-vue-next'

const emit = defineEmits<{ activate: [id: string] }>()
const { sessions, activeId, loading, load, create, remove, rename, activate } = useSession()

const creating = ref(false)
const newTitle = ref('')
const editingId = ref<string | null>(null)
const editTitle = ref('')

async function doCreate() {
  const title = newTitle.value.trim()
  if (!title) return
  const s = await create(title)
  if (s) { activate(s.id); emit('activate', s.id) }
  newTitle.value = ''
  creating.value = false
}

async function doDelete(id: string) {
  await remove(id)
  if (activeId.value === id) {
    const next = sessions.value[0]
    if (next) { activate(next.id); emit('activate', next.id) }
  }
}

async function doRename(id: string) {
  const title = editTitle.value.trim()
  if (!title) { editingId.value = null; return }
  await rename(id, title)
  editingId.value = null
}

onMounted(() => { load().then(() => { if (sessions.value[0]) { activate(sessions.value[0].id); emit('activate', sessions.value[0].id) } }) })
</script>

<template>
  <aside class="session-sidebar" aria-label="Sessions">
    <div class="session-sidebar-head">
      <span>Sessions</span>
      <button class="session-new-btn" title="New session" @click="creating = true; newTitle = ''">
        <Plus :size="15" />
      </button>
    </div>

    <div v-if="creating" class="session-create-row">
      <input v-model="newTitle" placeholder="Session name" @keyup.enter="doCreate" @keyup.escape="creating = false" />
      <button @click="doCreate"><Check :size="14" /></button>
    </div>

    <div v-if="loading" class="session-sidebar-empty"><p>Loading...</p></div>

    <ul v-else class="session-list">
      <li v-for="s in sessions" :key="s.id"
        class="session-row" :class="{ active: s.id === activeId }"
        @click="activate(s.id); emit('activate', s.id)">
        <div class="session-row-main">
          <span v-if="editingId === s.id" class="session-rename-wrap">
            <input v-model="editTitle" @keyup.enter="doRename(s.id)" @keyup.escape="editingId = null"
              @click.stop />
          </span>
          <span v-else class="session-title" @dblclick="editingId = s.id; editTitle = s.title">{{ s.title }}</span>
          <small>{{ s.preview || s.updated_at?.slice(0, 10) }}</small>
        </div>
        <button class="session-del-btn" title="Delete" @click.stop="doDelete(s.id)">
          <Trash2 :size="13" />
        </button>
      </li>
    </ul>
  </aside>
</template>
