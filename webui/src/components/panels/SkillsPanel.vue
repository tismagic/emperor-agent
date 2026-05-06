<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SkillInfo } from '../../types'

const props = defineProps<{ skills: SkillInfo[]; activeSkill: string | null; content: string }>()
const emit = defineEmits<{ load: [name: string]; new: [name: string]; save: [content: string] }>()

const filter = ref('')
const draft = ref('')
watch(() => props.content, (content) => { draft.value = content }, { immediate: true })

const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return props.skills
  return props.skills.filter((skill) => `${skill.name} ${skill.description || ''} ${skill.path}`.toLowerCase().includes(query))
})

function createSkill() {
  const name = window.prompt('Skill 名称，例如 video-planner')?.trim()
  if (name) emit('new', name)
}
</script>

<template>
  <div class="panel-content split-panel">
    <div class="panel-toolbar">
      <input v-model="filter" placeholder="筛选 skill" />
      <button class="tool-button" @click="createSkill">新增</button>
    </div>

    <div class="split-body">
      <div class="resource-list">
        <button
          v-for="skill in filtered"
          :key="skill.name"
          class="list-item text-left"
          :class="{ active: props.activeSkill === skill.name }"
          @click="emit('load', skill.name)"
        >
          <div class="min-w-0">
            <div class="item-title">{{ skill.name }}</div>
            <div class="item-desc">{{ skill.description || skill.path }}</div>
          </div>
          <div class="badge-row">
            <span v-if="skill.always" class="badge gold">always</span>
            <span class="badge">md</span>
          </div>
        </button>
        <div v-if="!filtered.length" class="empty-note">还没有发现 skill。</div>
      </div>

      <div v-if="!props.activeSkill" class="empty-state">选择一个 skill，或新建一个能力包。</div>
      <div v-else class="editor">
        <div class="editor-title">{{ props.activeSkill }} / SKILL.md</div>
        <textarea v-model="draft" />
        <div class="editor-actions">
          <span class="status-pill">保存后刷新 system prompt</span>
          <button class="tool-button ink" @click="emit('save', draft)">保存 skill</button>
        </div>
      </div>
    </div>
  </div>
</template>
