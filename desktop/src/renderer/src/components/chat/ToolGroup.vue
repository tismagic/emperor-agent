<script setup lang="ts">
import { computed } from 'vue'
import type { ToolSegment, ToolStatus } from '../../types'
import { toolIcon } from '../../icons'
import type { AssistantFlowBlock } from './assistantFlowProjection'
import ToolDetailBody from './ToolDetailBody.vue'

type ToolGroupBlock = Extract<AssistantFlowBlock, { kind: 'tool_group' }>

const props = defineProps<{ block: ToolGroupBlock }>()

const defaultOpen = computed(() =>
  props.block.status !== 'done' ||
  props.block.tools.some((tool) => Boolean(tool.subagents?.length)),
)

const primaryTool = computed(() => props.block.tools[0])
const runningTools = computed(() => props.block.tools.filter((tool) => tool.status === 'running'))
const errorTools = computed(() => props.block.tools.filter((tool) => tool.status === 'error' || tool.status === 'error_aborted'))
const completedCount = computed(() => props.block.tools.filter((tool) => tool.status === 'done').length)
const latestTodos = computed(() => {
  for (let index = props.block.tools.length - 1; index >= 0; index -= 1) {
    const tool = props.block.tools[index]
    if (tool?.todos?.length) return tool.todos
  }
  return []
})
const isTodoOnlyGroup = computed(() => props.block.tools.every((tool) => tool.name === 'update_todos'))
const agentCount = computed(() =>
  props.block.tools.reduce((count, tool) => {
    const ownAgent = tool.name === 'dispatch_subagent' ? 1 : 0
    return count + ownAgent + (tool.subagents?.length || 0)
  }, 0),
)

const statusText = computed(() => statusLabel(props.block.status))
const singleTool = computed(() => props.block.tools.length === 1)
const detailText = computed(() => {
  if (runningTools.value.length) return `正在执行 ${toolNames(runningTools.value)}`
  if (errorTools.value.length) return `${errorTools.value.length} 个工具需要处理`
  if (isTodoOnlyGroup.value && latestTodos.value.length) return `已更新 ${latestTodos.value.length} 个任务步骤`
  if (latestTodos.value.length) return `已同步 ${latestTodos.value.length} 个任务步骤`
  return `已完成 ${completedCount.value}/${props.block.tools.length} 个工具`
})

function toolNames(tools: ToolSegment[]) {
  return tools
    .map((tool) => tool.displayName || tool.name)
    .slice(0, 2)
    .join('、')
}

function statusLabel(status: ToolStatus) {
  if (status === 'done') return '完成'
  if (status === 'running') return '执行中'
  if (status === 'error_aborted') return '已中断'
  return '出错'
}

function toolStatusLabel(tool: ToolSegment) {
  return statusLabel(tool.status)
}

function durationLabel(ms?: number) {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function isTodoTool(tool: ToolSegment) {
  return tool.name === 'update_todos' && Boolean(tool.todos?.length)
}

function toolTitle(tool: ToolSegment) {
  return tool.displayName || tool.name
}

function toolPurpose(tool: ToolSegment) {
  const purposes: Record<string, string> = {
    dispatch_subagent: '派遣子代理',
    edit_file: '修改文件',
    glob: '匹配路径',
    grep: '搜索文本',
    load_skill: '加载 Skill',
    read_file: '读取文件',
    run_command: '执行命令',
    scheduler: '调度任务',
    update_todos: '更新任务',
    web_fetch: '读取网页',
    write_file: '写入文件',
  }
  return purposes[tool.name] || '工具执行'
}
</script>

<template>
  <details class="timeline-node tool-group-card" :class="props.block.status" :open="defaultOpen">
    <summary class="tool-group-summary">
      <span class="tool-group-icon" aria-hidden="true">
        <component :is="toolIcon(primaryTool?.name || 'tool')" :size="15" />
      </span>
      <span class="tool-group-main">
        <strong>{{ props.block.title }}</strong>
        <small>{{ detailText }}</small>
      </span>
      <span class="tool-group-meta">
        <em v-if="agentCount">Agent × {{ agentCount }}</em>
        <em>{{ statusText }}</em>
        <time v-if="durationLabel(props.block.durationMs)">{{ durationLabel(props.block.durationMs) }}</time>
      </span>
    </summary>

    <div class="tool-group-body">
      <template v-for="tool in props.block.tools" :key="tool.id">
        <details v-if="isTodoTool(tool)" class="tool-raw-details">
          <summary>查看原始工具详情</summary>
          <ToolDetailBody :segment="tool" />
        </details>
        <ToolDetailBody
          v-else-if="singleTool"
          :segment="tool"
        />
        <section
          v-else
          class="tool-group-tool-row"
          :class="tool.status"
        >
          <header class="tool-group-tool-head">
            <span class="tool-group-tool-icon" aria-hidden="true">
              <component :is="toolIcon(tool.name)" :size="14" />
            </span>
            <span class="tool-group-tool-title">
              <strong>{{ toolTitle(tool) }}</strong>
              <small>{{ toolPurpose(tool) }}</small>
            </span>
            <span class="tool-group-tool-meta">
              <em>{{ toolStatusLabel(tool) }}</em>
              <time v-if="durationLabel(tool.durationMs)">{{ durationLabel(tool.durationMs) }}</time>
            </span>
          </header>
          <ToolDetailBody :segment="tool" />
        </section>
      </template>
    </div>
  </details>
</template>
