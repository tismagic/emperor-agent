<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolInfo } from '../../types'

const props = defineProps<{ tools: ToolInfo[] }>()
const filter = ref('')
const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return props.tools
  return props.tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query))
})
</script>

<template>
  <div class="panel-content">
    <div class="panel-toolbar">
      <input v-model="filter" placeholder="筛选 tool" />
    </div>
    <div class="panel-scroll space-y-3">
      <div v-for="tool in filtered" :key="tool.name" class="list-item tool-card">
        <div class="min-w-0">
          <div class="item-title">{{ tool.name }}</div>
          <div class="item-desc">{{ tool.description }}</div>
        </div>
        <div class="badge-row">
          <span class="badge" :class="tool.read_only ? 'green' : 'red'">{{ tool.read_only ? 'read' : 'write' }}</span>
          <span v-if="tool.concurrency_safe" class="badge green">parallel</span>
          <span v-if="tool.exclusive" class="badge gold">exclusive</span>
        </div>
      </div>
      <div v-if="!filtered.length" class="empty-state">没有匹配的 tool。</div>
    </div>
  </div>
</template>
