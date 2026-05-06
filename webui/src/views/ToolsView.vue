<script setup lang="ts">
import { useAppContext } from '../composables/useAppContext'
import ToolsPanel from '../components/panels/ToolsPanel.vue'

const ctx = useAppContext()
</script>

<template>
  <section class="main-view">
    <header class="view-head">
      <div class="min-w-0">
        <h1>工具权限 · Tools</h1>
        <p>当前注册的内建工具与 MCP 工具</p>
      </div>
      <button class="icon-button" title="刷新" @click="ctx.refreshAll()">刷</button>
    </header>
    <div class="view-body view-body-fill">
      <ToolsPanel :tools="ctx.boot.value?.tools || []" />
    </div>
  </section>
</template>
