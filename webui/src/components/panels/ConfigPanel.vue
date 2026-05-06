<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ConfigInfo } from '../../types'

const props = defineProps<{ configs: ConfigInfo[]; activeConfig: string | null; content: string }>()
const emit = defineEmits<{ load: [path: string]; save: [content: string] }>()

const allowed = new Set(['templates/TOOL.md', 'templates/USER.md'])
const draft = ref('')
watch(() => props.content, (content) => { draft.value = content }, { immediate: true })

const visibleConfigs = computed(() => props.configs.filter((file) => allowed.has(file.path)))

function select(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) emit('load', value)
}
</script>

<template>
  <div class="panel-content split-panel compact-split">
    <div class="panel-toolbar">
      <select :value="props.activeConfig || ''" @change="select">
        <option value="">选择工具配置或用户档案</option>
        <option v-for="file in visibleConfigs" :key="file.path" :value="file.path">{{ file.name || file.path }}</option>
      </select>
    </div>

    <div v-if="!props.activeConfig" class="empty-state">这里只开放 TOOL.md 和 USER.md，可查看也可编辑。</div>
    <div v-else class="editor flex-1">
      <div class="editor-title">{{ props.activeConfig }}</div>
      <textarea v-model="draft" />
      <div class="editor-actions">
        <span class="status-pill">保存后刷新 Agent 上下文</span>
        <button class="tool-button ink" @click="emit('save', draft)">保存配置</button>
      </div>
    </div>
  </div>
</template>
