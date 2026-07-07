<script setup lang="ts">
import { actionIcons, brandIcon } from '../../icons'

defineProps<{
  open: boolean
  message: string
}>()

const emit = defineEmits<{
  close: []
  configure: []
}>()
</script>

<template>
  <div v-if="open" class="onboarding-backdrop" role="presentation">
    <section class="onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="model-setup-title">
      <header class="onboarding-head">
        <div class="onboarding-brand">
          <component :is="brandIcon" :size="22" :stroke-width="1.8" />
        </div>
        <div>
          <h2 id="model-setup-title">需要配置模型</h2>
          <p>model_config.json</p>
        </div>
      </header>

      <div class="onboarding-note">
        {{ message }}
      </div>

      <footer class="onboarding-actions">
        <span>配置完成后就可以开始对话。</span>
        <button class="tool-button" type="button" @click="emit('close')">
          稍后配置
        </button>
        <button class="tool-button ink asset-button primary-action" type="button" @click="emit('configure')">
          <component :is="actionIcons.save" class="action-icon" :size="16" />
          <span>去配置模型</span>
        </button>
      </footer>
    </section>
  </div>
</template>
