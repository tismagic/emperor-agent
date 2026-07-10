<script setup lang="ts">
import { computed } from 'vue'
import type { TodoItem } from '../../types'

const props = defineProps<{ todos: TodoItem[] }>()

function marker(status: string) {
  if (status === 'completed') return '✓'
  if (status === 'in_progress') return '●'
  return '□'
}

const completedCount = computed(
  () => props.todos.filter((todo) => todo.status === 'completed').length,
)
const activeCount = computed(
  () => props.todos.filter((todo) => todo.status === 'in_progress').length,
)
const pendingCount = computed(
  () => props.todos.length - completedCount.value - activeCount.value,
)

const summary = computed(() => {
  const parts = [`${completedCount.value} 完成`]
  if (activeCount.value) parts.push(`${activeCount.value} 进行中`)
  parts.push(`${pendingCount.value} 待办`)
  return parts.join(' · ')
})
</script>

<template>
  <section class="todo-panel">
    <div class="todo-panel-head">
      <h3>任务步骤</h3>
      <span>{{ summary }}</span>
    </div>
    <div class="todo-items">
      <div
        v-for="todo in props.todos"
        :key="todo.id"
        class="todo-item"
        :class="todo.status"
      >
        <span class="todo-mark">{{ marker(todo.status) }}</span>
        <em>{{ todo.id }}</em>
        <p>{{ todo.content }}</p>
      </div>
    </div>
  </section>
</template>
