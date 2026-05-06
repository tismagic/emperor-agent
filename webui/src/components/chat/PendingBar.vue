<script setup lang="ts">
import type { PendingState } from '../../types'

const props = defineProps<{ pending: PendingState }>()
</script>

<template>
  <div v-if="props.pending.label" class="pending-bar">
    <span class="pending-dot" />
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold text-ink">{{ props.pending.label }}</div>
      <div v-if="props.pending.detail" class="truncate text-xs text-muted">{{ props.pending.detail }}</div>
    </div>
  </div>
</template>
