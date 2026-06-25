<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  void router.replace('/plugins/mcp')
})
</script>

<template>
  <section class="main-view">
    <div class="view-body">
      <div class="empty-note">正在打开插件 MCP 配置...</div>
    </div>
  </section>
</template>
