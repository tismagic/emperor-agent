<script setup lang="ts">
import { computed } from 'vue'
import { useAppContext } from '../../composables/useAppContext'
import { formatCompactNumber } from '../../utils/format'
import { navOrder } from '../../router'

const ctx = useAppContext()

const navItems = computed(() => {
  const labels: Record<(typeof navOrder)[number], { label: string; hint: string }> = {
    chat: { label: 'Chat', hint: '御前对话' },
    model: { label: 'Model', hint: '模型厂家' },
    tokens: { label: 'Tokens', hint: '用量账本' },
    skills: { label: 'Skills', hint: '能力包' },
    tools: { label: 'Tools', hint: '工具权限' },
    configs: { label: 'Config', hint: '工具 / 用户' },
    memory: { label: 'Memory', hint: '记忆层' },
  }
  return navOrder.map((name) => ({
    name,
    to: name === 'chat' ? '/chat' : `/${name}`,
    ...labels[name],
  }))
})

const counts = computed(() => ({
  providers: ctx.boot.value?.modelConfig?.providerOptions?.length || 0,
  tokens: ctx.boot.value?.memory?.tokenTotals?.total || 0,
  skills: ctx.boot.value?.skills?.length || 0,
  tools: ctx.boot.value?.tools?.length || 0,
}))

const current = computed(() => ctx.boot.value?.modelConfig?.current)

function dotClass() {
  if (ctx.busy.value) return 'busy'
  if (ctx.status.value === 'error') return 'error'
  return ''
}
</script>

<template>
  <aside class="nav-rail">
    <div class="brand-panel">
      <div class="seal-block">
        <div class="seal">令</div>
        <div class="seal-lines" aria-hidden="true" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="brand-title">Emperor Agent</p>
        <p class="truncate text-xs text-muted">
          {{ current?.provider || ctx.boot.value?.provider || 'provider' }} / {{ current?.model || ctx.boot.value?.model || 'model' }}
        </p>
      </div>
      <button class="icon-button" title="刷新" @click="ctx.refreshAll()">刷</button>
    </div>

    <div class="rail-status">
      <span class="status-pill"><span class="dot" :class="dotClass()" />{{ ctx.runtimeText() }}</span>
      <span class="mini-code">single context</span>
    </div>

    <div class="rail-metrics" aria-label="Agent resources">
      <div class="metric"><strong>{{ counts.providers }}</strong><span>Models</span></div>
      <div class="metric"><strong>{{ formatCompactNumber(counts.tokens) }}</strong><span>Tokens</span></div>
      <div class="metric"><strong>{{ counts.skills }}</strong><span>Skills</span></div>
      <div class="metric"><strong>{{ counts.tools }}</strong><span>Tools</span></div>
    </div>

    <nav class="rail-actions" aria-label="Primary navigation">
      <router-link
        v-for="item in navItems"
        :key="item.name"
        :to="item.to"
        class="rail-action"
        active-class="active"
      >
        <span>{{ item.label }}</span>
        <small>{{ item.hint }}</small>
      </router-link>
    </nav>

    <div class="rail-footer">
      <button class="tool-button wide" @click="ctx.clearChat()">清空当前屏幕</button>
      <p>清空只影响网页显示，不会删除运行期记忆。</p>
    </div>
  </aside>
</template>
