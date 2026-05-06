<script setup lang="ts">
import { useAppContext } from '../composables/useAppContext'
import MemoryPanel from '../components/panels/MemoryPanel.vue'

const ctx = useAppContext()
</script>

<template>
  <section class="main-view view-readable">
    <header class="view-head">
      <div class="min-w-0">
        <h1>记忆层 · Memory</h1>
        <p>长期记忆、今日情景与历史归档</p>
      </div>
      <button class="icon-button" title="刷新" @click="ctx.runSafely(() => ctx.refreshMemory(true))">刷</button>
    </header>
    <div class="view-body">
      <MemoryPanel
        :memory="ctx.boot.value?.memory || null"
        @refresh="ctx.runSafely(() => ctx.refreshMemory(true))"
      />
    </div>
  </section>
</template>
