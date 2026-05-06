<script setup lang="ts">
import { useAppContext } from '../composables/useAppContext'
import ModelPanel from '../components/panels/ModelPanel.vue'
import type { ModelConfigRaw } from '../types'

const ctx = useAppContext()

function onSave(config: ModelConfigRaw) {
  void ctx.runSafely(() => ctx.saveModelConfig(config))
}
</script>

<template>
  <section class="main-view view-readable">
    <header class="view-head">
      <div class="min-w-0">
        <h1>模型与厂家</h1>
        <p>切换 Provider、模型、上下文窗口与推理配置</p>
      </div>
      <button class="icon-button" title="刷新" @click="ctx.refreshAll()">刷</button>
    </header>
    <div class="view-body">
      <ModelPanel
        :payload="ctx.boot.value?.modelConfig || null"
        @save="onSave"
        @error="ctx.showToast"
      />
    </div>
  </section>
</template>
