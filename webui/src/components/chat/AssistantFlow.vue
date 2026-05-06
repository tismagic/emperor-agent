<script setup lang="ts">
import type { AssistantMessage } from '../../types'
import MarkdownBlock from './MarkdownBlock.vue'
import TodoPanel from './TodoPanel.vue'
import ToolEvent from './ToolEvent.vue'

const props = defineProps<{ message: AssistantMessage }>()
</script>

<template>
  <article class="message-row assistant">
    <div class="avatar assistant">李</div>
    <div class="flow-body">
      <template v-if="!props.message.segments.length && props.message.streaming">
        <div class="bubble assistant streaming">正在思量...</div>
      </template>
      <template v-for="(segment, index) in props.message.segments" :key="segment.id">
        <div
          v-if="segment.type === 'text'"
          class="bubble assistant"
          :class="{ streaming: props.message.streaming && index === props.message.segments.length - 1 }"
        >
          <MarkdownBlock :content="segment.content" />
        </div>
        <ToolEvent v-else :segment="segment" />
      </template>
      <TodoPanel v-if="props.message.todos?.length" :todos="props.message.todos" />
    </div>
  </article>
</template>
