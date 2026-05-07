<script setup lang="ts">
import { computed } from 'vue'
import type { TokensPayload, TokensRange } from '../../../types'
import { formatNumber } from '../../../utils/format'
import {
  buildHeatmap,
  filterByRange,
  peakHourLabel,
  topModelDisplay,
  rangeDays,
} from '../../../utils/tokens'

const props = defineProps<{ tokens: TokensPayload | null; range: TokensRange }>()

const heatmap = computed(() => buildHeatmap(props.tokens?.byDate ?? {}))

const rangedBuckets = computed(() =>
  filterByRange(props.tokens?.byDate ?? {}, props.range),
)

const rangedTotals = computed(() => {
  const buckets = rangedBuckets.value
  let total = 0
  let active = 0
  for (const b of buckets) {
    total += b.total
    if (b.total > 0) active += 1
  }
  return { total, active }
})

const cards = computed(() => {
  const tokens = props.tokens
  if (!tokens) {
    const empty = '—'
    return [
      { label: 'Sessions', value: empty, hint: '会话次数' },
      { label: 'Messages', value: empty, hint: '历史消息条数' },
      { label: 'Total tokens', value: empty, hint: '累计 Token 用量' },
      { label: 'Active days', value: empty, hint: '活跃天数' },
      { label: 'Current streak', value: empty, hint: '当前连续天数' },
      { label: 'Longest streak', value: empty, hint: '最长连续天数' },
      { label: 'Peak hour', value: empty, hint: '高峰时段' },
      { label: 'Favorite model', value: empty, hint: '使用最多模型' },
    ]
  }
  const days = rangeDays(props.range)
  const totalLabel = days == null ? '累计 Token' : `近 ${days} 天 Token`
  const activeLabel = days == null ? '出现过的天数' : `近 ${days} 天活跃天数`
  return [
    { label: 'Sessions', value: formatNumber(tokens.sessions), hint: '相邻调用 > 30 分钟视为新会话' },
    { label: 'Messages', value: formatNumber(tokens.messages), hint: 'history.jsonl 中的对话条数' },
    { label: 'Total tokens', value: formatNumber(rangedTotals.value.total), hint: totalLabel },
    { label: 'Active days', value: formatNumber(rangedTotals.value.active), hint: activeLabel },
    { label: 'Current streak', value: `${tokens.streak.current_streak} 天`, hint: '截至今天的连续天数' },
    { label: 'Longest streak', value: `${tokens.streak.longest_streak} 天`, hint: '历史最长连续天数' },
    { label: 'Peak hour', value: peakHourLabel(tokens.byHour), hint: '消耗最多 Token 的时段' },
    { label: 'Favorite model', value: topModelDisplay(tokens.byModel), hint: '总量最高的模型' },
  ]
})

const weekdayLabels = ['一', '三', '五']

function cellTitle(date: string | null, total: number, calls: number) {
  if (!date) return ''
  if (total === 0) return `${date} · 无记录`
  return `${date} · ${formatNumber(total)} tokens · ${formatNumber(calls)} calls`
}
</script>

<template>
  <div class="tokens-overview">
    <section class="stat-grid">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-card-label">{{ card.label }}</span>
        <strong class="stat-card-value">{{ card.value }}</strong>
        <small class="stat-card-hint">{{ card.hint }}</small>
      </article>
    </section>

    <section class="activity-heatmap-card">
      <header class="heatmap-head">
        <strong>活跃热力图</strong>
        <span class="heatmap-legend">
          <em>更少</em>
          <i class="legend-cell" data-level="0" />
          <i class="legend-cell" data-level="1" />
          <i class="legend-cell" data-level="2" />
          <i class="legend-cell" data-level="3" />
          <i class="legend-cell" data-level="4" />
          <em>更多</em>
        </span>
      </header>
      <div class="heatmap-frame">
        <div class="heatmap-months" :style="{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, 14px)` }">
          <span
            v-for="m in heatmap.months"
            :key="`${m.weekIndex}-${m.label}`"
            :style="{ gridColumnStart: m.weekIndex + 1 }"
          >
            {{ m.label }}
          </span>
        </div>
        <div class="heatmap-body">
          <div class="heatmap-weekdays">
            <span v-for="(label, idx) in weekdayLabels" :key="label" :style="{ gridRowStart: idx * 2 + 2 }">
              {{ label }}
            </span>
          </div>
          <div
            class="heatmap-grid"
            :style="{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, 14px)` }"
          >
            <div
              v-for="(week, wIdx) in heatmap.weeks"
              :key="wIdx"
              class="heatmap-col"
            >
              <div
                v-for="(cell, dIdx) in week"
                :key="dIdx"
                class="heatmap-cell"
                :data-level="cell.level"
                :data-empty="cell.date === null ? '1' : '0'"
                :title="cellTitle(cell.date, cell.total, cell.calls)"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
