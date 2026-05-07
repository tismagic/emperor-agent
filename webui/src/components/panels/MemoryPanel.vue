<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MemoryPayload } from '../../types'
import { actionAssets, emptyAssets } from '../../assets'
import MarkdownBlock from '../chat/MarkdownBlock.vue'

const props = defineProps<{
  memory: MemoryPayload | null
  loadEpisode: (date: string) => Promise<{ date: string; content: string }>
}>()
const emit = defineEmits<{
  refresh: []
  saveLongTerm: [content: string]
  saveEpisode: [date: string, content: string]
}>()

type MemoryTab = 'long_term' | 'episodes'
const tab = ref<MemoryTab>('long_term')

const longTermDraft = ref('')
const longTermPreview = ref(false)

watch(() => props.memory?.long_term, (val) => {
  longTermDraft.value = val || ''
}, { immediate: true })

const selectedEpisode = ref<{ date: string; content: string } | null>(null)
const episodeDraft = ref('')
const episodePreview = ref(false)
const episodeLoading = ref(false)

async function selectEpisode(path: string) {
  const date = path.split('/').pop()?.replace('.md', '') || ''
  if (!date) return
  episodeLoading.value = true
  try {
    const data = await props.loadEpisode(date)
    selectedEpisode.value = data
    episodeDraft.value = data.content
    episodePreview.value = false
  } finally {
    episodeLoading.value = false
  }
}

function saveLongTerm() {
  emit('saveLongTerm', longTermDraft.value)
}

function saveEpisode() {
  if (!selectedEpisode.value) return
  emit('saveEpisode', selectedEpisode.value.date, episodeDraft.value)
}

const sortedEpisodes = computed(() => {
  const eps = props.memory?.episodes || []
  return [...eps].sort((a, b) => b.localeCompare(a))
})
</script>

<template>
  <div class="panel-content split-panel">
    <div class="panel-toolbar">
      <div class="memory-tabs" role="tablist">
        <button
          class="memory-tab"
          :data-active="tab === 'long_term' ? 'true' : 'false'"
          @click="tab = 'long_term'"
        >
          长期记忆
        </button>
        <button
          class="memory-tab"
          :data-active="tab === 'episodes' ? 'true' : 'false'"
          @click="tab = 'episodes'"
        >
          情景记忆
        </button>
      </div>
    </div>

    <div v-if="!props.memory" class="empty-state illustrated-empty">
      <img :src="emptyAssets.memory" alt="" />
      <span>暂无记忆数据。</span>
    </div>

    <div v-else-if="tab === 'long_term'" class="editor flex-1">
      <div class="editor-title">
        <span>MEMORY.local.md</span>
        <button class="badge preview-toggle" :class="{ active: longTermPreview }" @click="longTermPreview = !longTermPreview">
          {{ longTermPreview ? '编辑' : '预览' }}
        </button>
      </div>
      <div v-if="longTermPreview" class="skill-preview">
        <MarkdownBlock :content="longTermDraft" />
      </div>
      <textarea v-else v-model="longTermDraft" />
      <div class="editor-actions">
        <span class="status-pill">保存后刷新 Agent 上下文</span>
        <button class="tool-button ink asset-button primary-action" @click="saveLongTerm">
          <img class="action-icon" :src="actionAssets.save" alt="" width="18" height="18" />
          <span>保存</span>
        </button>
      </div>
    </div>

    <div v-else class="split-body memory-body">
      <div class="resource-list episode-list">
        <div v-for="path in sortedEpisodes" :key="path" class="list-item episode-card" :class="{ active: selectedEpisode?.date === path.split('/').pop()?.replace('.md', '') }" @click="selectEpisode(path)">
          <div class="min-w-0">
            <div class="item-title">{{ path.split('/').pop()?.replace('.md', '') }}</div>
            <div class="item-desc">{{ path }}</div>
          </div>
          <span class="badge">md</span>
        </div>
        <div v-if="!sortedEpisodes.length" class="empty-note">还没有情景记忆。</div>
      </div>

      <div v-if="episodeLoading" class="empty-state illustrated-empty">
        <span>加载中...</span>
      </div>
      <div v-else-if="!selectedEpisode" class="empty-state illustrated-empty">
        <img :src="emptyAssets.memory" alt="" />
        <span>选择一个情景记忆文件以查看或编辑。</span>
      </div>
      <div v-else class="editor flex-1">
        <div class="editor-title">
          <span>{{ selectedEpisode.date }}.md</span>
          <button class="badge preview-toggle" :class="{ active: episodePreview }" @click="episodePreview = !episodePreview">
            {{ episodePreview ? '编辑' : '预览' }}
          </button>
        </div>
        <div v-if="episodePreview" class="skill-preview">
          <MarkdownBlock :content="episodeDraft" />
        </div>
        <textarea v-else v-model="episodeDraft" />
        <div class="editor-actions">
          <span class="status-pill">{{ selectedEpisode.date }}</span>
          <button class="tool-button ink asset-button primary-action" @click="saveEpisode">
            <img class="action-icon" :src="actionAssets.save" alt="" width="18" height="18" />
            <span>保存</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
