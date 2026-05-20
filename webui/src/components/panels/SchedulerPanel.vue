<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api/http'
import { useAppContext } from '../../composables/useAppContext'
import type { SchedulerJob, SchedulerPayload, SchedulerSchedule } from '../../types'
import { navAssets, toolIcon } from '../../assets'

const ctx = useAppContext()
const selectedId = ref('')
const loading = ref(false)
const createName = ref('')
const createKind = ref<'agent_turn' | 'team_wake'>('agent_turn')
const createMessage = ref('')
const createTarget = ref('')
const createDeliver = ref(true)
const createDeleteAfterRun = ref(false)
const scheduleKind = ref<'at' | 'every' | 'cron'>('every')
const atLocal = ref('')
const everyMinutes = ref(60)
const cronExpr = ref('0 9 * * *')
const cronTz = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
const editName = ref('')
const editMessage = ref('')
const editTarget = ref('')
const editDeliver = ref(true)

const scheduler = computed<SchedulerPayload>(() => ctx.boot.value?.scheduler || {
  status: { running: false, jobs: 0, enabled: 0, nextRunAtMs: null, lastError: null },
  jobs: [],
})
const jobs = computed(() => scheduler.value.jobs || [])
const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) || jobs.value[0] || null)
const runHistory = computed(() => {
  if (selected.value?.state?.runHistory?.length) return [...selected.value.state.runHistory].reverse()
  return jobs.value
    .flatMap((job) => (job.state?.runHistory || []).map((run) => ({ ...run, jobName: job.name, jobId: job.id })))
    .sort((a, b) => Number(b.runAtMs || 0) - Number(a.runAtMs || 0))
    .slice(0, 40)
})
const enabledCount = computed(() => scheduler.value.status?.enabled || 0)
const nextRunLabel = computed(() => formatMs(scheduler.value.status?.nextRunAtMs))

watch(jobs, () => {
  if (!selectedId.value && jobs.value.length) selectedId.value = jobs.value[0].id
  if (selectedId.value && !jobs.value.some((job) => job.id === selectedId.value)) selectedId.value = jobs.value[0]?.id || ''
}, { immediate: true })

watch(selected, (job) => {
  editName.value = job?.name || ''
  editMessage.value = job?.payload?.message || ''
  editTarget.value = job?.payload?.target || ''
  editDeliver.value = job?.payload?.deliver !== false
}, { immediate: true })

async function refreshScheduler() {
  loading.value = true
  try {
    const payload = await api<SchedulerPayload>('/api/scheduler')
    if (ctx.boot.value) ctx.boot.value.scheduler = payload
  } finally {
    loading.value = false
  }
}

async function createJob() {
  if (!createMessage.value.trim()) return
  loading.value = true
  try {
    const result = await api<{ job: SchedulerJob; scheduler: SchedulerPayload }>('/api/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify({
        name: createName.value.trim() || defaultJobName(),
        schedule: buildCreateSchedule(),
        payload: {
          kind: createKind.value,
          message: createMessage.value.trim(),
          target: createKind.value === 'team_wake' ? createTarget.value.trim() : null,
          deliver: createDeliver.value,
        },
        deleteAfterRun: createDeleteAfterRun.value,
      }),
    })
    if (ctx.boot.value) ctx.boot.value.scheduler = result.scheduler
    selectedId.value = result.job.id
    createName.value = ''
    createMessage.value = ''
    createTarget.value = ''
    ctx.showToast(`Scheduler job 已创建：${result.job.name}`)
  } finally {
    loading.value = false
  }
}

async function saveSelected() {
  if (!selected.value) return
  loading.value = true
  try {
    const result = await api<{ job: SchedulerJob; scheduler: SchedulerPayload }>(
      `/api/scheduler/jobs/${encodeURIComponent(selected.value.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.value.trim() || selected.value.name,
          payload: {
            ...selected.value.payload,
            message: editMessage.value.trim(),
            target: selected.value.payload.kind === 'team_wake' ? editTarget.value.trim() : null,
            deliver: editDeliver.value,
          },
        }),
      },
    )
    if (ctx.boot.value) ctx.boot.value.scheduler = result.scheduler
    ctx.showToast('Scheduler job 已保存')
  } finally {
    loading.value = false
  }
}

async function runSelected() {
  if (!selected.value) return
  await schedulerAction(selected.value, 'run', '已手动运行任务')
}

async function pauseSelected() {
  if (!selected.value) return
  await schedulerAction(selected.value, 'pause', '任务已暂停')
}

async function resumeSelected() {
  if (!selected.value) return
  await schedulerAction(selected.value, 'resume', '任务已恢复')
}

async function deleteSelected() {
  if (!selected.value || selected.value.protected) return
  if (!window.confirm(`删除 Scheduler job「${selected.value.name}」？`)) return
  loading.value = true
  try {
    const result = await api<{ deleted: string; scheduler: SchedulerPayload }>(
      `/api/scheduler/jobs/${encodeURIComponent(selected.value.id)}`,
      { method: 'DELETE' },
    )
    if (ctx.boot.value) ctx.boot.value.scheduler = result.scheduler
    selectedId.value = jobs.value[0]?.id || ''
    ctx.showToast('Scheduler job 已删除')
  } finally {
    loading.value = false
  }
}

async function schedulerAction(job: SchedulerJob, action: 'run' | 'pause' | 'resume', toast: string) {
  loading.value = true
  try {
    const result = await api<{ scheduler: SchedulerPayload }>(
      `/api/scheduler/jobs/${encodeURIComponent(job.id)}/${action}`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    if (ctx.boot.value) ctx.boot.value.scheduler = result.scheduler
    ctx.showToast(toast)
  } finally {
    loading.value = false
  }
}

function buildCreateSchedule(): SchedulerSchedule {
  if (scheduleKind.value === 'at') {
    return { kind: 'at', atMs: atLocal.value ? new Date(atLocal.value).getTime() : Date.now() + 60 * 60 * 1000 }
  }
  if (scheduleKind.value === 'cron') {
    return { kind: 'cron', expr: cronExpr.value.trim() || '0 9 * * *', tz: cronTz.value.trim() || 'UTC' }
  }
  return { kind: 'every', everyMs: Math.max(1, Number(everyMinutes.value || 1)) * 60 * 1000 }
}

function defaultJobName() {
  return createKind.value === 'team_wake' ? 'Team wake' : 'Agent turn'
}

function scheduleLabel(job: SchedulerJob) {
  const schedule = job.schedule || { kind: 'every' }
  if (schedule.kind === 'at') return `at ${formatMs(schedule.atMs)}`
  if (schedule.kind === 'cron') return `cron ${schedule.expr || '-'} · ${schedule.tz || 'local'}`
  return `every ${formatDuration(schedule.everyMs || 0)}`
}

function payloadLabel(job: SchedulerJob) {
  if (job.payload.kind === 'team_wake') return `team_wake · ${job.payload.target || '-'}`
  if (job.payload.kind === 'system_event') return 'system_event'
  return 'agent_turn'
}

function statusLabel(job: SchedulerJob) {
  if (!job.enabled) return 'Paused'
  if (job.state?.lastStatus === 'error') return 'Error'
  if (job.protected) return 'Protected'
  return 'Enabled'
}

function statusClass(job: SchedulerJob) {
  return ['scheduler-job-row', { active: job.id === selected.value?.id, paused: !job.enabled, error: job.state?.lastStatus === 'error' }]
}

function runStatusLabel(status?: string) {
  if (status === 'ok') return 'OK'
  if (status === 'error') return 'Error'
  if (status === 'skipped') return 'Skipped'
  return status || '-'
}

function formatDuration(ms?: number) {
  const value = Math.max(0, Number(ms || 0))
  if (value >= 60_000) return `${Math.round(value / 60_000)}m`
  if (value >= 1000) return `${Math.round(value / 1000)}s`
  return `${value}ms`
}

function formatMs(ms?: number | null) {
  if (!ms) return '-'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="panel-content scheduler-panel">
    <div class="scheduler-layout">
      <section class="scheduler-roster">
        <div class="team-section-head">
          <div>
            <h2>Jobs</h2>
            <p>{{ jobs.length }} jobs · {{ enabledCount }} enabled</p>
          </div>
          <button class="icon-button" title="刷新" :disabled="loading" @click="refreshScheduler">↻</button>
        </div>

        <div class="scheduler-summary">
          <div>
            <span>Next Run</span>
            <strong>{{ nextRunLabel }}</strong>
          </div>
          <div>
            <span>Service</span>
            <strong>{{ scheduler.status.running ? 'Running' : 'Stopped' }}</strong>
          </div>
        </div>

        <div class="scheduler-job-list">
          <button
            v-for="job in jobs"
            :key="job.id"
            :class="statusClass(job)"
            @click="selectedId = job.id"
          >
            <img class="scheduler-job-icon" :src="navAssets.schedulerActive" alt="" width="42" height="42" />
            <span class="min-w-0 flex-1">
              <strong>{{ job.name }}</strong>
              <small>{{ scheduleLabel(job) }}</small>
              <small>{{ payloadLabel(job) }}</small>
            </span>
            <em>{{ statusLabel(job) }}</em>
          </button>
          <div v-if="!jobs.length" class="scheduler-empty">No scheduler jobs yet.</div>
        </div>

        <form class="scheduler-create" @submit.prevent="createJob">
          <div class="team-form-row">
            <input v-model="createName" placeholder="job name" autocomplete="off" />
            <select v-model="createKind">
              <option value="agent_turn">agent_turn</option>
              <option value="team_wake">team_wake</option>
            </select>
          </div>
          <textarea v-model="createMessage" rows="3" placeholder="message / prompt" />
          <input v-if="createKind === 'team_wake'" v-model="createTarget" placeholder="teammate name" autocomplete="off" />
          <div class="team-form-row">
            <select v-model="scheduleKind">
              <option value="every">every</option>
              <option value="at">at</option>
              <option value="cron">cron</option>
            </select>
            <input v-if="scheduleKind === 'every'" v-model.number="everyMinutes" min="1" type="number" />
            <input v-else-if="scheduleKind === 'at'" v-model="atLocal" type="datetime-local" />
            <input v-else v-model="cronExpr" placeholder="0 9 * * *" />
          </div>
          <input v-if="scheduleKind === 'cron'" v-model="cronTz" placeholder="Asia/Shanghai" />
          <label class="scheduler-check"><input v-model="createDeliver" type="checkbox" /> deliver result to runtime</label>
          <label class="scheduler-check"><input v-model="createDeleteAfterRun" type="checkbox" /> delete one-time job after run</label>
          <button class="tool-button wide ink" :disabled="loading || !createMessage.trim()">创建任务</button>
        </form>
      </section>

      <section class="scheduler-timeline">
        <div class="team-section-head">
          <div>
            <h2>{{ selected?.name || 'Run History' }}</h2>
            <p>{{ selected ? `${selected.id} · ${payloadLabel(selected)}` : '最近运行记录' }}</p>
          </div>
          <span v-if="selected" class="team-status-pill" :class="{ working: selected.enabled, error: selected.state?.lastStatus === 'error' }">
            {{ statusLabel(selected) }}
          </span>
        </div>

        <div class="scheduler-run-scroll">
          <article
            v-for="run in runHistory"
            :key="`${run.runAtMs}-${run.status}-${run.error || ''}`"
            class="scheduler-run"
            :class="run.status"
          >
            <div class="team-message-top">
              <strong>{{ 'jobName' in run ? run.jobName : selected?.name || 'Scheduler' }}</strong>
              <span>{{ formatMs(run.runAtMs) }}</span>
            </div>
            <p>{{ runStatusLabel(run.status) }} · {{ formatDuration(run.durationMs) }}</p>
            <small v-if="run.error">{{ run.error }}</small>
          </article>
          <div v-if="!runHistory.length" class="team-empty">
            <img :src="navAssets.schedulerActive" alt="" width="96" height="96" />
            <span>尚无运行记录。</span>
          </div>
        </div>
      </section>

      <aside class="scheduler-detail">
        <div class="team-section-head">
          <div>
            <h2>Details</h2>
            <p>{{ selected ? scheduleLabel(selected) : 'Select a job' }}</p>
          </div>
        </div>

        <div v-if="selected" class="scheduler-detail-body">
          <div class="team-stamp">
            <img :src="navAssets.schedulerActive" alt="" width="64" height="64" />
            <div class="min-w-0">
              <strong>{{ selected.name }}</strong>
              <span>{{ selected.protected ? 'protected job' : selected.id }}</span>
            </div>
          </div>

          <div class="scheduler-meta-grid">
            <span><b>Schedule</b>{{ scheduleLabel(selected) }}</span>
            <span><b>Payload</b>{{ payloadLabel(selected) }}</span>
            <span><b>Next</b>{{ formatMs(selected.state?.nextRunAtMs) }}</span>
            <span><b>Last</b>{{ selected.state?.lastStatus || '-' }}</span>
          </div>

          <input v-model="editName" autocomplete="off" />
          <textarea v-model="editMessage" rows="5" placeholder="message" />
          <input v-if="selected.payload.kind === 'team_wake'" v-model="editTarget" autocomplete="off" placeholder="teammate name" />
          <label class="scheduler-check"><input v-model="editDeliver" type="checkbox" /> deliver result to runtime</label>

          <div class="team-tool-cloud">
            <span><img :src="toolIcon('scheduler')" alt="" width="18" height="18" /> scheduler</span>
            <span>{{ selected.deleteAfterRun ? 'delete after run' : 'persistent' }}</span>
            <span>{{ selected.payload.kind }}</span>
          </div>

          <div class="scheduler-action-grid">
            <button class="tool-button ink" :disabled="loading || selected.protected" @click="saveSelected">保存</button>
            <button class="tool-button" :disabled="loading" @click="runSelected">运行</button>
            <button v-if="selected.enabled" class="tool-button" :disabled="loading" @click="pauseSelected">暂停</button>
            <button v-else class="tool-button" :disabled="loading" @click="resumeSelected">恢复</button>
            <button class="tool-button danger" :disabled="loading || selected.protected" @click="deleteSelected">删除</button>
          </div>

          <div v-if="selected.state?.lastError" class="team-error">{{ selected.state.lastError }}</div>
        </div>

        <div v-else class="scheduler-detail-body muted">
          <p>司时台尚未登记任务。</p>
        </div>
      </aside>
    </div>
  </div>
</template>
