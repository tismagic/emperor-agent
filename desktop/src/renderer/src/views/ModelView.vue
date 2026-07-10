<script setup lang="ts">
import { useAppContext } from '../composables/useAppContext'
import ModelPanel from '../components/panels/ModelPanel.vue'
import type { ModelConfigRaw } from '../types'
import { actionIcons } from '../icons'

const ctx = useAppContext()

function onSave(config: ModelConfigRaw) {
  void ctx.runSafely(() => ctx.saveModelConfig(config))
}

function onRefresh() {
  void ctx.runSafely(() => ctx.refreshAll())
}

function openConfigWizard() {
  ctx.openOnboarding()
}
</script>

<template>
  <section class="main-view view-readable model-settings-view">
    <header class="view-head">
      <div class="min-w-0">
        <h1>模型与厂家</h1>
        <p>多条目管理；激活的条目决定后续主 Agent / 子代理 / 压缩任务用哪份凭证</p>
      </div>
      <div class="view-head-actions">
        <button class="tool-button asset-button primary-action" title="打开模型配置向导" @click="openConfigWizard">
          <component :is="actionIcons.new" class="action-icon" :size="16" />
          <span>配置向导</span>
        </button>
      </div>
    </header>
    <div class="view-body">
      <ModelPanel
        :payload="ctx.boot.value?.modelConfig || null"
        @save="onSave"
        @error="ctx.showToast"
        @refresh="onRefresh"
      />
    </div>
  </section>
</template>
