<script setup lang="ts">
import { useAppContext } from '../composables/useAppContext'
import ProjectExecutionPanel from '../components/panels/ProjectExecutionPanel.vue'
import { actionIcons } from '../icons'

const ctx = useAppContext()
</script>

<template>
  <section class="main-view">
    <header class="view-head">
      <div class="min-w-0">
        <h1>项目执行 · Project Execution</h1>
        <p>计划步骤、验证矩阵、独立复核与审批历史</p>
      </div>
      <button class="tool-button asset-button refresh-action" title="刷新" @click="ctx.refreshAll()">
        <component :is="actionIcons.refresh" class="action-icon" :size="16" />
        <span>刷新</span>
      </button>
    </header>
    <div class="view-body view-body-fill">
      <ProjectExecutionPanel />
    </div>
  </section>
</template>
