<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppContext } from '../../composables/useAppContext'
import { planExecutionSummary } from '../../runtime/handlers/plans'
import { activeProjectPlan, reviewerTaskId } from '../../runtime/projectExecution'
import ReviewerTranscriptDrawer from './ReviewerTranscriptDrawer.vue'

const ctx = useAppContext()
const plans = computed(() => ctx.planProjection.plans || [])
const plan = computed(() => activeProjectPlan(plans.value))
const summary = computed(() => planExecutionSummary(plan.value))
const reviewerTask = computed(() => reviewerTaskId(plan.value))
const steps = computed(() => plan.value?.steps || [])
const drawerOpen = ref(false)
</script>

<template>
  <div class="panel project-execution-panel">
    <div v-if="!plan" class="panel-empty">暂无进行中的项目执行计划</div>
    <template v-else>
      <section class="pe-section pe-plan-head">
        <h3>{{ plan.title }}</h3>
        <span class="pe-status">{{ plan.status }}</span>
      </section>

      <section class="pe-section pe-steps">
        <h3>计划步骤</h3>
        <ol class="pe-step-list">
          <li v-for="step in steps" :key="step.id" :data-status="step.status">
            <span class="pe-step-status">{{ step.status }}</span>
            <span class="pe-step-title">{{ step.title }}</span>
          </li>
        </ol>
      </section>

      <section class="pe-section pe-verification" :data-status="summary.independentVerificationStatus">
        <h3>独立复核 · {{ summary.independentVerificationStatus }}</h3>
        <p v-if="summary.independentVerificationSummary">{{ summary.independentVerificationSummary }}</p>
        <ul v-if="summary.independentVerificationCommands.length" class="pe-commands">
          <li v-for="cmd in summary.independentVerificationCommands" :key="cmd"><code>{{ cmd }}</code></li>
        </ul>
        <button v-if="reviewerTask" class="tool-button" @click="drawerOpen = true">
          打开复核 transcript
        </button>
      </section>

      <section v-if="summary.failedVerificationSummary" class="pe-section pe-failed">
        <h3>验证失败</h3>
        <p>{{ summary.failedVerificationSummary }}</p>
      </section>

      <section v-if="summary.blockedReason" class="pe-section pe-blocked">
        <h3>阻塞原因</h3>
        <p>{{ summary.blockedReason }}</p>
      </section>

      <section v-if="summary.openQuestionsCount" class="pe-section pe-questions">
        <h3>待答问题：{{ summary.openQuestionsCount }}</h3>
      </section>

      <ReviewerTranscriptDrawer
        v-if="reviewerTask"
        v-model:open="drawerOpen"
        :task-id="reviewerTask"
      />
    </template>
  </div>
</template>
