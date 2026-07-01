<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MediaArtifactRef } from '../../types'
import { mediaRawUrl } from '../../api/media'

const props = defineProps<{ items: MediaArtifactRef[] }>()
const selected = ref<MediaArtifactRef | null>(null)

const imageItems = computed(() => props.items.filter((item) => item.kind === 'image'))

function imageUrl(item: MediaArtifactRef): string {
  return mediaRawUrl(item.id)
}

function closePreview() {
  selected.value = null
}
</script>

<template>
  <div v-if="imageItems.length" class="media-preview-grid">
    <button
      v-for="item in imageItems"
      :key="item.id"
      type="button"
      class="media-preview-item"
      :title="item.originalPath || item.name"
      @click="selected = item"
    >
      <img :src="imageUrl(item)" :alt="item.name" loading="lazy" />
      <span>{{ item.name }}</span>
    </button>
  </div>

  <div v-if="selected" class="media-preview-modal" role="dialog" aria-modal="true" @click.self="closePreview">
    <button type="button" class="media-preview-close" aria-label="关闭预览" @click="closePreview">×</button>
    <img :src="imageUrl(selected)" :alt="selected.name" />
    <div class="media-preview-caption">
      <strong>{{ selected.name }}</strong>
      <span>{{ selected.mime }}</span>
      <code>{{ selected.originalPath }}</code>
    </div>
  </div>
</template>
