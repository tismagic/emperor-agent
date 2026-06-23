<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SkillsPanel from '../components/panels/SkillsPanel.vue'
import ToolsPanel from '../components/panels/ToolsPanel.vue'
import { useAppContext } from '../composables/useAppContext'
import { actionIcons } from '../icons'

const ctx = useAppContext()
const route = useRoute()
const router = useRouter()

const activeTab = computed(() => route.params.tab === 'tools' ? 'tools' : 'skills')

watch(
  () => route.query.skill,
  (raw) => {
    const name = Array.isArray(raw) ? raw[0] : raw
    if (!name || activeTab.value !== 'skills') return
    if (ctx.activeSkill.value === name) return
    void ctx.runSafely(() => ctx.loadSkill(name))
  },
  { immediate: true },
)

function switchTab(tab: 'skills' | 'tools') {
  void router.push({ name: 'plugins', params: { tab } })
}

function onLoad(name: string) {
  void router.push({ name: 'plugins', params: { tab: 'skills' }, query: { skill: name } })
}

function onNew(name: string) {
  ctx.startNewSkill(name)
  void router.push({ name: 'plugins', params: { tab: 'skills' }, query: { skill: name } })
}

function onSave(content: string) {
  void ctx.runSafely(() => ctx.saveSkill(content))
}

function onDelete(name: string) {
  void ctx.runSafely(() => ctx.deleteSkill(name))
}

async function onImport(formData: FormData) {
  await ctx.importSkill(formData)
}
</script>

<template>
  <section class="main-view">
    <header class="view-head">
      <div class="min-w-0">
        <h1>插件</h1>
        <p>Skill 与 Tool 是对话中可调用能力的两个入口</p>
      </div>
      <div class="plugins-head-actions">
        <div class="segmented-control">
          <button :class="{ active: activeTab === 'skills' }" @click="switchTab('skills')">Skills</button>
          <button :class="{ active: activeTab === 'tools' }" @click="switchTab('tools')">Tools</button>
        </div>
        <button class="tool-button asset-button refresh-action" title="刷新" @click="ctx.refreshAll()">
          <component :is="actionIcons.refresh" class="action-icon" :size="16" />
          <span>刷新</span>
        </button>
      </div>
    </header>
    <div class="view-body view-body-fill">
      <SkillsPanel
        v-if="activeTab === 'skills'"
        :skills="ctx.boot.value?.skills || []"
        :active-skill="ctx.activeSkill.value"
        :content="ctx.skillContent.value"
        @load="onLoad"
        @new="onNew"
        @save="onSave"
        @delete="onDelete"
        @import="onImport"
      />
      <ToolsPanel v-else :tools="ctx.boot.value?.tools || []" />
    </div>
  </section>
</template>
