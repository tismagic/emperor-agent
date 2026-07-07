<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Play, RefreshCw, Save, Shield, Terminal } from 'lucide-vue-next'
import { core } from '../../api/http'
import type { HookAuditPayload, HookDefinitionPayload, HooksConfigPayload, HooksPayload } from '../../types'

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const draft = ref('')
const payload = ref<HooksPayload | null>(null)
const audit = ref<HookAuditPayload | null>(null)
const testResult = ref<Record<string, unknown> | null>(null)

const mergedHooks = computed(() => {
  const hooks = payload.value?.config?.hooks ?? {}
  return Object.entries(hooks).flatMap(([eventName, entries]) =>
    (entries || []).map((hook) => ({ ...hook, eventName: hook.eventName || eventName })),
  )
})

const globalConfig = computed<HooksConfigPayload>(() => payload.value?.globalConfig || payload.value?.config || { version: 1, enabled: true, projectHooks: { enabled: false }, hooks: {} })

onMounted(() => {
  void load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    payload.value = await core<HooksPayload>('hooks.getConfig')
    audit.value = await core<HookAuditPayload>('hooks.getAudit', { limit: 20 })
    draft.value = JSON.stringify(globalConfig.value, null, 2)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const parsed = JSON.parse(draft.value) as HooksConfigPayload
    payload.value = await core<HooksPayload>('hooks.saveConfig', parsed)
    audit.value = await core<HookAuditPayload>('hooks.getAudit', { limit: 20 })
    draft.value = JSON.stringify(payload.value.globalConfig || parsed, null, 2)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function testRun() {
  testing.value = true
  error.value = ''
  try {
    testResult.value = await core<Record<string, unknown>>('hooks.testRun', {
      eventName: 'PreToolUse',
      toolName: 'read_file',
      toolInput: { path: 'README.md' },
    })
    audit.value = await core<HookAuditPayload>('hooks.getAudit', { limit: 20 })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    testing.value = false
  }
}

function sourceLabel(hook: HookDefinitionPayload) {
  const source = hook.source
  if (!source) return 'global'
  return `${source.kind || 'source'}${source.readonly ? ' · read-only' : ''}`
}
</script>

<template>
  <section class="main-view hooks-panel">
    <header class="view-head">
      <div class="min-w-0">
        <h1>Hooks</h1>
        <p>全局私有配置可编辑，项目 .emperor/settings*.json 只读导入</p>
      </div>
      <div class="hooks-actions">
        <button class="tool-button asset-button" title="刷新" :disabled="loading" @click="load">
          <RefreshCw :size="16" />
          <span>刷新</span>
        </button>
        <button class="tool-button asset-button" title="测试运行" :disabled="testing" @click="testRun">
          <Play :size="16" />
          <span>测试</span>
        </button>
      </div>
    </header>

    <div class="view-body view-body-fill">
      <div class="hooks-layout">
        <section class="hooks-main">
          <div class="hooks-summary">
            <div>
              <Shield :size="17" />
              <span>启用</span>
              <strong>{{ payload?.config?.enabled === false ? '否' : '是' }}</strong>
            </div>
            <div>
              <Terminal :size="17" />
              <span>Hooks</span>
              <strong>{{ payload?.summary?.total || 0 }}</strong>
            </div>
            <div>
              <AlertTriangle :size="17" />
              <span>诊断</span>
              <strong>{{ payload?.diagnostics?.length || 0 }}</strong>
            </div>
          </div>

          <div v-if="error" class="hooks-error">{{ error }}</div>

          <div class="hooks-section">
            <div class="hooks-section-head">
              <h2>来源</h2>
            </div>
            <div v-if="!payload?.sources?.length" class="empty-note">暂无 hooks 配置来源。</div>
            <div v-else class="hooks-source-list">
              <div v-for="source in payload.sources" :key="`${source.kind}:${source.path}`" class="hooks-source-row">
                <div>
                  <strong>{{ source.kind }}</strong>
                  <span>{{ source.path }}</span>
                </div>
                <code>{{ source.readonly ? 'read-only' : 'editable' }}</code>
              </div>
            </div>
          </div>

          <div class="hooks-section">
            <div class="hooks-section-head">
              <h2>已加载 hooks</h2>
            </div>
            <div v-if="!mergedHooks.length" class="empty-note">暂无已启用 hooks。</div>
            <div v-else class="hooks-table">
              <div v-for="hook in mergedHooks" :key="`${hook.eventName}:${hook.id}`" class="hooks-row">
                <div>
                  <strong>{{ hook.id }}</strong>
                  <span>{{ hook.eventName }} · {{ hook.matcher || '*' }} · {{ hook.handler?.type }}</span>
                </div>
                <code>{{ sourceLabel(hook) }}</code>
              </div>
            </div>
          </div>

          <div class="hooks-section">
            <div class="hooks-section-head">
              <h2>最近审计</h2>
            </div>
            <div v-if="!audit?.records?.length" class="empty-note">暂无审计记录。</div>
            <div v-else class="hooks-audit-list">
              <div v-for="record in audit.records" :key="String(record.id)" class="hooks-audit-row">
                <div>
                  <strong>{{ record.hookId }}</strong>
                  <span>{{ record.eventName }} · {{ record.status }} · {{ record.decision }}</span>
                </div>
                <code>{{ record.durationMs }}ms</code>
              </div>
            </div>
          </div>
        </section>

        <aside class="hooks-editor">
          <div class="editor-title">stateRoot/hooks_config.json</div>
          <textarea v-model="draft" spellcheck="false" />
          <div class="editor-actions">
            <span class="status-pill">只保存全局私有 hooks</span>
            <button class="tool-button ink asset-button primary-action" :disabled="saving" @click="save">
              <Save :size="16" />
              <span>保存</span>
            </button>
          </div>
          <pre v-if="testResult" class="hooks-test-result">{{ JSON.stringify(testResult, null, 2) }}</pre>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hooks-panel {
  overflow: hidden;
}

.hooks-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.hooks-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 1rem;
  min-height: 0;
  height: 100%;
}

.hooks-main,
.hooks-editor {
  min-height: 0;
  overflow: auto;
}

.hooks-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hooks-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.hooks-summary div,
.hooks-section,
.hooks-editor {
  border: 1px solid rgb(var(--line) / 0.7);
  background: rgb(var(--paper) / 0.78);
  border-radius: 8px;
}

.hooks-summary div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.35rem 0.5rem;
  padding: 0.85rem;
}

.hooks-summary strong {
  grid-column: 1 / -1;
  font: 800 1.3rem var(--font-display);
}

.hooks-section {
  overflow: hidden;
}

.hooks-section-head {
  padding: 0.8rem 1rem;
  border-bottom: 1px solid rgb(var(--line) / 0.6);
}

.hooks-section-head h2 {
  font: 800 0.95rem var(--font-display);
}

.hooks-source-list,
.hooks-table,
.hooks-audit-list {
  display: flex;
  flex-direction: column;
}

.hooks-source-row,
.hooks-row,
.hooks-audit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border-top: 1px solid rgb(var(--line) / 0.4);
}

.hooks-source-row:first-child,
.hooks-row:first-child,
.hooks-audit-row:first-child {
  border-top: 0;
}

.hooks-source-row strong,
.hooks-row strong,
.hooks-audit-row strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hooks-source-row span,
.hooks-row span,
.hooks-audit-row span {
  display: block;
  overflow-wrap: anywhere;
  color: rgb(var(--muted));
  font-size: 0.78rem;
  margin-top: 0.25rem;
}

.hooks-source-row code,
.hooks-row code,
.hooks-audit-row code {
  align-self: center;
  white-space: nowrap;
}

.hooks-editor {
  display: flex;
  flex-direction: column;
  padding: 0.9rem;
}

.hooks-editor textarea {
  min-height: 22rem;
  flex: 1;
  resize: none;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.55;
}

.hooks-error {
  border: 1px solid rgb(var(--seal) / 0.32);
  background: rgb(var(--seal) / 0.1);
  color: rgb(var(--seal));
  border-radius: 8px;
  padding: 0.75rem 0.9rem;
  font-size: 0.82rem;
}

.hooks-test-result {
  max-height: 12rem;
  overflow: auto;
  margin-top: 0.75rem;
  border: 1px solid rgb(var(--line) / 0.55);
  border-radius: 8px;
  padding: 0.75rem;
  font-size: 0.72rem;
  background: rgb(var(--paper2) / 0.55);
}

@media (max-width: 980px) {
  .hooks-layout {
    grid-template-columns: 1fr;
  }

  .hooks-summary {
    grid-template-columns: 1fr;
  }
}
</style>
