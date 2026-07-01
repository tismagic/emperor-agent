<script setup lang="ts">
import { computed } from 'vue'
import type { ThoughtSegment } from '../../types'
import { thoughtPresentation } from './thoughtDisplay'

const props = defineProps<{ segment: ThoughtSegment; executionDurationMs?: number }>()

const presentation = computed(() => thoughtPresentation(props.segment, props.executionDurationMs))
const isSummary = computed(() => presentation.value.kind === 'summary')
const summary = computed(() => presentation.value.kind === 'summary' ? presentation.value.summary : '')
const label = computed(() => presentation.value.kind === 'status' ? presentation.value.label : '')
</script>

<template>
  <div v-if="isSummary" class="timeline-node thought-summary-node">
    <p class="thought-summary">{{ summary }}</p>
  </div>
  <div v-else class="timeline-node thought-node" :class="[props.segment.status]">
    <span class="thought-label">{{ label }}</span>
    <span class="thought-chevron" aria-hidden="true">›</span>
  </div>
</template>
